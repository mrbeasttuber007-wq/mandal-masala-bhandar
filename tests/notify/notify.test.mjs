// Tests the REAL Edge Function code + REAL database queue, with fake Resend / WhatsApp servers.
// Run: bash tests/db/reset.sh mmb_notify && PGDB=mmb_notify tsx --test tests/notify/
import test from 'node:test';
import assert from 'node:assert/strict';
import { startGateway, SERVICE_KEY } from '../helpers/gateway.mjs';
import { rpc as rawRpc, sql } from '../helpers/pg.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const owner = { role: 'authenticated', uid: OWNER };
const rpc = (fn, args = {}, ctx = {}) => rawRpc(fn, ['place_order', 'admin_save_zone', 'admin_save_product', 'admin_save_notification_settings', 'admin_save_store_settings'].includes(fn) ? { p: args } : args, ctx);
let gw, vid, seq = 0;
const call = async (body, token) => (await fetch(gw.url + '/functions/v1/notifications', { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) })).json();
const control = (b) => fetch(gw.url + '/__control', { method: 'POST', body: JSON.stringify(b) }).then((r) => r.json());
const ownerToken = async () => (await (await fetch(gw.url + '/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email: 'owner@example.com', password: 'pw-owner' }) })).json()).access_token;
const place = (extra = {}) => rpc('place_order', { idempotency_key: crypto.randomUUID(), customer: { name: 'Rina <b>Das</b>', phone: '8' + String(200000000 + ++seq), email: 'rina@example.com', address: 'Ward 3, near temple\nKalitala', locality: 'Kalitala', city: 'Beldanga', state: 'West Bengal', pin: '742175', notes: 'Call at gate', ...extra }, items: [{ variant_id: vid, quantity: 2 }] }, { role: 'anon' });
const q = (s) => sql(s);

test.before(async () => {
  sql(`insert into auth.users (id,email) values ('${OWNER}','owner@example.com') on conflict do nothing`);
  sql(`insert into profiles (id, full_name, role) values ('${OWNER}','Owner','owner') on conflict do nothing`);
  const cat = rpc('admin_list_categories', {}, owner)[0].id;
  vid = rpc('admin_save_product', { category_id: cat, name: 'Garam Masala', variants: [{ label: '100g', price: 120, stock_qty: 500 }] }, owner).variants[0].id;
  rpc('admin_save_zone', { name: 'Town', pin_codes: '742175', delivery_charge: 30 }, owner);
  gw = await startGateway({ users: { 'owner@example.com': { id: OWNER, password: 'pw-owner' } } });
});
test.after(async () => { await gw.close(); });
const settings = (o = {}) => rpc('admin_save_notification_settings', { owner_email: 'owner@example.com', owner_whatsapp: '9800011122', owner_email_enabled: true, owner_whatsapp_enabled: true, customer_email_enabled: true, customer_whatsapp_enabled: true, ...o }, owner);

test('NOT CONFIGURED: order still saved; messages are marked skipped with a clear reason', async () => {
  settings();
  const o = place();
  assert.ok(o.order_code);
  const r = await call({ action: 'drain' });
  assert.deepEqual([r.sent, r.failed, r.skipped], [0, 0, 4]);
  assert.equal(q(`select status from orders where order_code='${o.order_code}'`), 'pending');
  const logs = rpc('admin_list_notifications', {}, owner);
  assert.ok(logs.every((l) => l.status === 'skipped' && /not set up/.test(l.last_error)));
  assert.equal(gw.state.resend.length + gw.state.whatsapp.length, 0);
});

test('CONFIGURED: owner + customer email and WhatsApp are sent with the right content', async () => {
  await control({ env: { RESEND_API_KEY: 're_test_123', WHATSAPP_TOKEN: 'wa_tok', WHATSAPP_PHONE_NUMBER_ID: '555' }, reset: true });
  q(`update notification_logs set status='queued', attempts=0, last_error=null`);   // what "Retry" does after setup
  const r = await call({ action: 'drain' });
  assert.deepEqual([r.sent, r.failed, r.skipped], [4, 0, 0]);
  const { resend, whatsapp } = await control({});
  assert.equal(resend.length, 2); assert.equal(whatsapp.length, 2);
  assert.equal(resend[0].auth, 'Bearer re_test_123');
  const ownerMail = resend.find((x) => x.body.to[0] === 'owner@example.com').body;
  assert.match(ownerMail.subject, /^New order MMB-[A-Z2-9]{8} - Rs\. 270\.00 \(COD\)$/);
  assert.match(ownerMail.html, /Rina &lt;b&gt;Das&lt;\/b&gt;/);                       // HTML-escaped (no injection)
  assert.ok(ownerMail.text.includes('Garam Masala (100g) x 2') && ownerMail.text.includes('Ward 3, near temple'));
  assert.ok(ownerMail.html.includes('Call at gate'));
  const custMail = resend.find((x) => x.body.to[0] === 'rina@example.com').body;
  assert.match(custMail.subject, /received/); assert.match(custMail.html, /shop\.example\/track\?code=MMB-/); assert.match(custMail.text, /Total \(Cash on Delivery\): Rs\. 270\.00/);
  assert.match(custMail.body ?? custMail.html, /onboarding@resend\.dev|Mandal/);
  assert.match(custMail.from, /Mandal Masala Bhandar/);
  const ownerWa = whatsapp.find((x) => x.body.to === '919800011122').body;
  assert.equal(ownerWa.template.name, 'mmb_owner_new_order');
  const params = ownerWa.template.components[0].parameters.map((p) => p.text);
  assert.equal(params.length, 6); assert.match(params[0], /^MMB-/); assert.equal(params[1], 'Rina <b>Das</b>'); assert.equal(params[4], 'Rs. 270.00');
  assert.ok(params.every((t) => !/[\n\t]/.test(t) && t.length > 0));                  // WhatsApp parameter rules
  const custWa = whatsapp.find((x) => x.body.to.startsWith('918')).body;
  assert.equal(custWa.template.name, 'mmb_order_confirmation'); assert.equal(custWa.template.components[0].parameters.length, 3);
  assert.equal(q(`select count(*) from notification_logs where status='sent' and provider_message_id is not null and sent_at is not null`), '4');
});

test('STATUS CHANGES: customer gets confirmed / out for delivery / delivered / cancelled messages', async () => {
  await control({ reset: true });
  const o = place({ email: 'status@example.com' });
  await call({ action: 'drain' }); await control({ reset: true });
  const id = q(`select id from orders where order_code='${o.order_code}'`);
  const t = await ownerToken();
  for (const st of ['confirmed', 'processing', 'out_for_delivery', 'delivered']) {
    rpc('admin_update_order_status', { p_id: id, p_status: st }, owner);
    await call({ action: 'drain' });
  }
  const { resend, whatsapp } = await control({});
  assert.deepEqual(resend.map((x) => x.body.subject.split(' - ')[0].replace(o.order_code, 'X')), ['Order X confirmed', 'Order X is out for delivery', 'Order X delivered']);
  assert.deepEqual(whatsapp.map((x) => x.body.template.components[0].parameters[2].text), ['Confirmed', 'Out for delivery', 'Delivered']);
  assert.ok(whatsapp.every((x) => x.body.template.name === 'mmb_order_status'));
  const o2 = place({ email: 'cancel@example.com' }); await call({ action: 'drain' }); await control({ reset: true });
  rpc('admin_update_order_status', { p_id: q(`select id from orders where order_code='${o2.order_code}'`), p_status: 'cancelled' }, owner);
  await call({ action: 'drain' });
  assert.match((await control({})).resend[0].body.subject, /cancelled/);
});

test('FAILURES: provider down => order untouched, failure logged, retried later and then succeeds', async () => {
  await control({ reset: true, providerMode: { resend: 'fail500', whatsapp: 'fail500' } });
  const o = place({ email: 'retry@example.com' });
  const r = await call({ action: 'drain' });
  assert.deepEqual([r.sent, r.failed], [0, 4]);
  assert.equal(q(`select status from orders where order_code='${o.order_code}'`), 'pending');          // order is safe
  const rows = q(`select n.status||'|'||n.attempts||'|'||n.last_error from notification_logs n join orders o on o.id=n.order_id where o.order_code='${o.order_code}' and n.channel='email' and n.recipient_type='owner'`);
  assert.match(rows, /^failed\|1\|Resend 503: upstream down/);
  assert.equal((await call({ action: 'drain' })).processed, 0);                                         // back-off: not due yet
  await control({ providerMode: { resend: 'ok', whatsapp: 'ok' }, reset: true });
  q(`update notification_logs set next_attempt_at = now() - interval '1 second' where status='failed'`);
  const r2 = await call({ action: 'drain' });
  assert.equal(r2.sent, 4);
  assert.equal(q(`select count(*) from notification_logs n join orders o on o.id=n.order_id where o.order_code='${o.order_code}' and n.status='sent'`), '4');
});

test('FAILURES: a rejected number/address is a permanent failure (not retried forever); other messages still go', async () => {
  await control({ reset: true, providerMode: { resend: 'ok', whatsapp: 'fail400' } });
  const o = place({ email: 'perm@example.com' });
  const r = await call({ action: 'drain' });
  assert.deepEqual([r.sent, r.failed], [2, 2]);
  const l = rpc('admin_list_notifications', { p: { status: 'failed' } }, owner).filter((x) => x.order_code === o.order_code);
  assert.equal(l.length, 2); assert.match(l[0].last_error, /WhatsApp 400 \(code 131030\)/);
  q(`update notification_logs set next_attempt_at = now() - interval '1 second'`);
  assert.equal((await call({ action: 'drain' })).processed, 0);                                         // not retried
  assert.ok(rpc('admin_dashboard', {}, owner).failed_notifications >= 2);
  // owner presses Retry after fixing things
  await control({ providerMode: { whatsapp: 'ok' }, reset: true });
  for (const x of l) rpc('admin_requeue_notification', { p_id: x.id }, owner);
  assert.equal((await call({ action: 'drain' })).sent, 2);
});

test('PARTIAL SETUP: email works while WhatsApp is not configured', async () => {
  await control({ reset: true, providerMode: { resend: 'ok', whatsapp: 'ok' }, env: { WHATSAPP_TOKEN: '' } });
  const o = place({ email: 'partial@example.com' });
  const r = await call({ action: 'drain' });
  assert.deepEqual([r.sent, r.skipped], [2, 2]);
  assert.equal((await control({})).whatsapp.length, 0);
  await control({ env: { WHATSAPP_TOKEN: 'wa_tok' } });
});

test('OWNER ONLY: status and test actions reject visitors and strangers', async () => {
  assert.equal((await call({ action: 'status' })).error, 'Owner only');
  assert.equal((await call({ action: 'test', channel: 'email', to: 'x@y.com' }, 'junk')).error, 'Owner only');
  const t = await ownerToken();
  const s = await call({ action: 'status' }, t);
  assert.equal(s.email.configured, true); assert.equal(s.whatsapp.configured, true);
  await control({ env: { WHATSAPP_TOKEN: '' } });
  const s2 = await call({ action: 'status' }, t);
  assert.deepEqual(s2.whatsapp.missing, ['WHATSAPP_TOKEN']);
  assert.ok(!JSON.stringify(s).includes('re_test_123'));                                                // secrets never returned
  await control({ env: { WHATSAPP_TOKEN: 'wa_tok' }, reset: true });
  assert.equal((await call({ action: 'test', channel: 'email', to: 'me@example.com' }, t)).ok, true);
  assert.equal((await call({ action: 'test', channel: 'email', to: 'bad' }, t)).ok, false);
  assert.equal((await call({ action: 'test', channel: 'whatsapp', to: '+91 98000 11122' }, t)).ok, true);
  const { whatsapp } = await control({});
  assert.equal(whatsapp[0].body.template.name, 'hello_world'); assert.equal(whatsapp[0].body.to, '919800011122');
  assert.equal((await call({ action: 'bogus' })).error, 'Unknown action');
  // drain never reveals customer data
  const d = await call({ action: 'drain' }); assert.deepEqual(Object.keys(d).sort(), ['failed', 'processed', 'sent', 'skipped']);
});
