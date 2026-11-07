// Database tests. Run:  bash tests/db/reset.sh && node --test tests/db/
// They exercise the REAL schema, Row Level Security and functions on PostgreSQL.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rpc as rawRpc, rpcAsync as rawRpcAsync, sql, PgError, lit } from '../helpers/pg.js';

// functions that take ONE json argument named "p" (like the website does: { p: {...} })
const WRAP = new Set(['place_order', 'admin_save_category', 'admin_save_product', 'admin_save_zone', 'admin_save_store_settings',
  'admin_save_notification_settings', 'admin_list_orders', 'admin_sales_report', 'admin_list_notifications']);
const wrap = (fn, args) => (WRAP.has(fn) && !('p' in args) ? { p: args } : args);
const rpc = (fn, args = {}, ctx = {}) => rawRpc(fn, wrap(fn, args), ctx);
const rpcAsync = (fn, args = {}, ctx = {}) => rawRpcAsync(fn, wrap(fn, args), ctx);

const OWNER = '11111111-1111-4111-8111-111111111111';
const STRANGER = '22222222-2222-4222-8222-222222222222';
const owner = { role: 'authenticated', uid: OWNER };
const stranger = { role: 'authenticated', uid: STRANGER };
const anon = { role: 'anon' };
const svc = { role: 'service_role' };
const uuid = () => crypto.randomUUID();

const rejects = (fn, re) => assert.throws(fn, (e) => { assert.ok(e instanceof PgError, String(e)); if (re) assert.match(e.message + ' ' + (e.hint || '') + ' ' + e.code, re); return true; });
const stock = (vid) => Number(sql(`select stock_qty from product_variants where id='${vid}'`));

const addr = { name: 'Rina Das', phone: '98765 43210', email: '', address: 'Ward 3, near the temple, Kalitala', locality: 'Kalitala', city: 'Beldanga', state: 'West Bengal', pin: '742175', notes: '' };
let phoneSeq = 0;
const freshPhone = () => '8' + String(100000000 + (++phoneSeq)).padStart(9, '0');   // a different customer each time
const order = (items, over = {}, cust = {}) => ({ idempotency_key: uuid(), customer: { ...addr, phone: freshPhone(), ...cust }, items, ...over });

let cat, turmeric, almonds, hidden, zone;

test.before(() => {
  sql(`insert into auth.users (id,email) values ('${OWNER}','owner@example.com'),('${STRANGER}','stranger@example.com')`);
  sql(`insert into profiles (id, full_name, role) values ('${OWNER}','Owner','owner')`);
  cat = rpc('admin_list_categories', {}, owner).find((c) => c.name === 'Ground Spices').id;
  const dry = rpc('admin_list_categories', {}, owner).find((c) => c.name === 'Dry Fruits').id;
  turmeric = rpc('admin_save_product', { category_id: cat, name: 'Turmeric Powder', short_description: 'Test', is_active: true,
    variants: [{ label: '100g', price: 40, stock_qty: 10 }, { label: '250g', price: 90, compare_at_price: 100, stock_qty: 2 }, { label: '500g', price: 170, stock_qty: 0 }] }, owner);
  almonds = rpc('admin_save_product', { category_id: dry, name: 'Almonds', variants: [{ label: '250g', price: 250, stock_qty: 1 }] }, owner);
  hidden = rpc('admin_save_product', { category_id: cat, name: 'Secret Inactive Item', is_active: false, variants: [{ label: '1kg', price: 999, stock_qty: 5 }] }, owner);
  zone = rpc('admin_save_zone', { name: 'Beldanga Town', pin_codes: '742175, 742133', delivery_charge: 30, min_order_value: 100, free_delivery_threshold: 500 }, owner);
});
const V = (p, label) => p.variants.find((v) => v.label === label).id;
// each test starts with plenty of stock (the 500g pack stays at 0 on purpose)
test.beforeEach(() => sql(`update product_variants set stock_qty = 1000, is_available = true where id in ('${V(turmeric, '100g')}','${V(turmeric, '250g')}','${V(almonds, '250g')}')`));

test('PUBLIC: anonymous visitors only see active products and no exact stock', () => {
  const cat1 = rpc('get_catalog', {}, anon);
  const names = cat1.products.map((p) => p.name);
  assert.ok(names.includes('Turmeric Powder'));
  assert.ok(!names.includes('Secret Inactive Item'));
  const t = cat1.products.find((p) => p.name === 'Turmeric Powder');
  assert.equal(t.variants.length, 3);
  assert.equal(t.variants.find((v) => v.label === '500g').in_stock, false);
  assert.ok(!JSON.stringify(cat1).includes('stock_qty'));
  // direct table access (what a hacker with the public key could try)
  assert.equal(sql(`select count(*) from products where name='Secret Inactive Item'`, anon), '0');
  rejects(() => sql(`select stock_qty from product_variants`, anon), /permission denied/);
});

test('SECURITY: anonymous visitors cannot read or write private tables', () => {
  for (const t of ['orders', 'order_items', 'order_status_history', 'notification_logs', 'notification_settings', 'profiles', 'delivery_zones', 'tracking_attempts']) {
    rejects(() => sql(`select * from ${t}`, anon), /permission denied/);
  }
  rejects(() => sql(`update products set name='hacked'`, anon), /permission denied/);
  rejects(() => sql(`delete from categories`, anon), /permission denied/);
  rejects(() => sql(`insert into product_variants(product_id,label,price) values ('${turmeric.id}','x',1)`, anon), /permission denied/);
  rejects(() => sql(`update store_settings set shop_name='hacked'`, anon), /permission denied/);
});

test('SECURITY: a signed-in stranger (not the owner) gets nothing', () => {
  assert.equal(sql(`select count(*) from orders`, stranger), '0');
  assert.equal(sql(`select count(*) from notification_settings`, stranger), '0');
  rejects(() => sql(`insert into products(category_id,name,slug) values ('${cat}','Evil','evil')`, stranger), /row-level security/);
  assert.equal(sql(`update products set name='hacked' returning 1`, stranger), '');   // 0 rows visible to update
  assert.equal(sql(`update store_settings set shop_name='hacked' returning 1`, stranger), '');
  rejects(() => sql(`insert into profiles(id) values ('${STRANGER}')`, stranger), /permission denied/);
  for (const [fn, args] of [['admin_list_orders', {}], ['admin_dashboard', {}], ['admin_save_product', { name: 'x', category_id: cat }],
    ['admin_get_settings', {}], ['admin_update_order_status', { p_id: uuid(), p_status: 'confirmed' }], ['admin_sales_report', {}]]) {
    rejects(() => rpc(fn, args, stranger), /not allowed|42501/);
    rejects(() => rpc(fn, args, anon), /permission denied|42501/);
  }
  rejects(() => rpc('claim_notifications', {}, stranger), /permission denied/);
  rejects(() => rpc('claim_notifications', {}, anon), /permission denied/);
  rejects(() => rpc('enqueue_notifications', { p_order_id: uuid(), p_event: 'order_placed' }, anon), /permission denied/);
  assert.equal(rpc('is_admin', {}, stranger), false);
  assert.equal(rpc('is_admin', {}, owner), true);
});

test('SECURITY: nobody can make themselves an admin through the API', () => {
  rejects(() => sql(`insert into profiles(id, role) values ('${STRANGER}','owner')`, stranger), /permission denied/);
  rejects(() => sql(`update profiles set is_active=true`, stranger), /permission denied/);
  assert.equal(rpc('is_admin', {}, stranger), false);
});

test('ORDER: totals are calculated on the server; browser prices are ignored', () => {
  const s0 = stock(V(turmeric, '100g'));
  const o = rpc('place_order', order([{ variant_id: V(turmeric, '100g'), quantity: 3, unit_price: 1, price: 1, total: 1 }], { total: 1, subtotal: 1, delivery_charge: 0 }, { phone: '98765 43210' }), anon);
  assert.equal(o.subtotal, 120);              // 3 x 40 from the database
  assert.equal(o.delivery_charge, 30);        // below free-delivery threshold
  assert.equal(o.total, 150);
  assert.match(o.order_code, /^MMB-[A-Z2-9]{8}$/);
  assert.equal(o.status, 'pending');
  assert.equal(stock(V(turmeric, '100g')), s0 - 3);
  const row = sql(`select status, customer_phone, subtotal, total, stock_deducted from orders where order_code='${o.order_code}'`, svc.role ? { role: 'postgres' } : {});
  assert.equal(row, `pending|9876543210|120.00|150.00|t`);
  assert.equal(sql(`select count(*) from order_status_history h join orders o on o.id=h.order_id where o.order_code='${o.order_code}' and to_status='pending'`), '1');
});

test('ORDER: wrong expected total from the browser is rejected and nothing is saved', () => {
  const before = sql(`select count(*) from orders`); const s0 = stock(V(turmeric, '100g'));
  rejects(() => rpc('place_order', order([{ variant_id: V(turmeric, '100g'), quantity: 3 }], { expected_total: 1 }), anon), /changed|price_changed/);
  assert.equal(sql(`select count(*) from orders`), before);
  assert.equal(stock(V(turmeric, '100g')), s0);
  const ok = rpc('place_order', order([{ variant_id: V(turmeric, '100g'), quantity: 3 }], { expected_total: 150 }), anon);   // 120 + 30
  assert.equal(ok.total, 150);
});

test('ORDER: free delivery threshold and minimum order come from the zone settings', () => {
  rpc('admin_set_variant_stock', { p_id: V(almonds, '250g'), p_stock: 5 }, owner);
  const mid = rpc('place_order', order([{ variant_id: V(almonds, '250g'), quantity: 1 }, { variant_id: V(turmeric, '250g'), quantity: 1 }]), anon);
  assert.equal(mid.subtotal, 340); assert.equal(mid.delivery_charge, 30);
  const free = rpc('place_order', order([{ variant_id: V(almonds, '250g'), quantity: 2 }]), anon);   // 500 = threshold
  assert.equal(free.delivery_charge, 0); assert.equal(free.total, 500);
  rejects(() => rpc('place_order', order([{ variant_id: V(turmeric, '100g'), quantity: 1 }]), anon), /minimum order/);
  // check_delivery mirrors the same rules (cart page)
  assert.deepEqual(rpc('check_delivery', { p_pin: '742175', p_subtotal: 120 }, anon).delivery_charge, 30);
  assert.deepEqual(rpc('check_delivery', { p_pin: '742175', p_subtotal: 600 }, anon).delivery_charge, 0);
  assert.equal(rpc('check_delivery', { p_pin: '999999', p_subtotal: 600 }, anon).deliverable, false);
});

test('ORDER: invalid details are refused with a clear message (phone, missing fields, PIN)', () => {
  const it = [{ variant_id: V(turmeric, '250g'), quantity: 2 }];
  const bad = (cust, re) => rejects(() => rpc('place_order', order(it, {}, cust), anon), re);
  for (const phone of ['12345', '5876543210', 'abcdefghij', '98765432', '98765432101', '']) bad({ phone }, /valid 10-digit/);
  bad({ name: '' }, /full name/); bad({ name: 'A' }, /full name/);
  bad({ address: 'short' }, /full delivery address/); bad({ locality: '' }, /locality/);
  bad({ city: '' }, /city/); bad({ state: '' }, /state/);
  for (const pin of ['', '12345', '0742175', '74217a']) bad({ pin }, /6-digit PIN/);
  bad({ pin: '700001' }, /do not deliver to PIN code 700001/);
  bad({ email: 'not-an-email' }, /valid email/);
  rejects(() => rpc('place_order', { idempotency_key: uuid(), customer: addr, items: [] }, anon), /cart is empty/);
  rejects(() => rpc('place_order', { idempotency_key: uuid(), customer: addr }, anon), /cart is empty/);
  rejects(() => rpc('place_order', { idempotency_key: 'nope', customer: addr, items: it }, anon), /Invalid order reference/);
  rejects(() => rpc('place_order', { customer: addr, items: it }, anon), /Invalid order reference/);
  rejects(() => rpc('place_order', order([{ variant_id: V(turmeric, '250g'), quantity: 0 }]), anon), /between 1 and 100/);
  rejects(() => rpc('place_order', order([{ variant_id: V(turmeric, '250g'), quantity: -2 }]), anon), /between 1 and 100/);
  rejects(() => rpc('place_order', order([{ variant_id: V(turmeric, '250g'), quantity: 1.5 }]), anon), /invalid item/);
  rejects(() => rpc('place_order', order([{ variant_id: uuid(), quantity: 1 }]), anon), /no longer available/);
  rejects(() => rpc('place_order', order([{ variant_id: 'junk', quantity: 1 }]), anon), /invalid item/);
  // phone formats that ARE accepted are normalised
  for (const phone of ['+91 98765-43210', '09876543210', '919876543210']) {
    const r = rpc('place_order', order(it, {}, { phone }), anon);
    assert.ok(r.order_code);
  }
  assert.equal(sql(`select count(distinct customer_phone) from orders where customer_phone='9876543210'`), '1');
});

test('ABUSE GUARD: more than 5 orders per hour from one mobile number is refused', () => {
  const it = [{ variant_id: V(turmeric, '100g'), quantity: 3 }];
  for (let i = 0; i < 5; i++) rpc('place_order', order(it, {}, { phone: '9555555555' }), anon);
  rejects(() => rpc('place_order', order(it, {}, { phone: '9555555555' }), anon), /Too many orders/);
});

test('STOCK: out-of-stock and not-enough-stock are refused; stock never goes negative', () => {
  rejects(() => rpc('place_order', order([{ variant_id: V(turmeric, '500g'), quantity: 1 }]), anon), /out of stock/);
  rpc('admin_set_variant_stock', { p_id: V(turmeric, '250g'), p_stock: 2 }, owner);
  const left = stock(V(turmeric, '250g'));
  rejects(() => rpc('place_order', order([{ variant_id: V(turmeric, '250g'), quantity: left + 1 }], {}, { phone: '9000000001' }), anon), new RegExp(`Only ${left} of Turmeric Powder`));
  assert.equal(stock(V(turmeric, '250g')), left);
  rejects(() => rpc('place_order', order([{ variant_id: V(hidden, '1kg'), quantity: 1 }]), anon), /not available/);
  rpc('admin_set_variant_stock', { p_id: V(turmeric, '250g'), p_available: false, p_stock: left }, owner);
  rejects(() => rpc('place_order', order([{ variant_id: V(turmeric, '250g'), quantity: 1 }]), anon), /not available/);
  rpc('admin_set_variant_stock', { p_id: V(turmeric, '250g'), p_available: true, p_stock: left }, owner);
  rejects(() => sql(`update product_variants set stock_qty = -1 where id='${V(turmeric, '250g')}'`), /check/);
  // the same pack size twice in one cart is merged, not double counted past stock
  rejects(() => rpc('place_order', order([{ variant_id: V(turmeric, '250g'), quantity: left }, { variant_id: V(turmeric, '250g'), quantity: 1 }], {}, { phone: '9000000002' }), anon), /Only/);
});

test('DUPLICATES: the same checkout sent twice creates ONE order and takes stock once', () => {
  const key = uuid(); const vid = V(turmeric, '100g'); const s0 = stock(vid);
  const body = order([{ variant_id: vid, quantity: 3 }], { idempotency_key: key });
  const a = rpc('place_order', body, anon); const b = rpc('place_order', body, anon);
  assert.equal(a.order_code, b.order_code); assert.equal(a.duplicate, false); assert.equal(b.duplicate, true);
  assert.equal(stock(vid), s0 - 3);
  assert.equal(sql(`select count(*) from orders where idempotency_key='${key}'`), '1');
});

test('CONCURRENCY: two customers racing for the last unit - exactly one wins, no overselling', async () => {
  const p = rpc('admin_save_product', { category_id: cat, name: 'Last One', variants: [{ label: '1kg', price: 200, stock_qty: 1 }] }, owner);
  const vid = p.variants[0].id;
  const runs = await Promise.all([1, 2, 3, 4].map((n) => rpcAsync('place_order', order([{ variant_id: vid, quantity: 1 }], {}, { phone: '90000000' + (10 + n) }), anon)));
  assert.equal(runs.filter((r) => r.ok).length, 1, JSON.stringify(runs));
  assert.equal(runs.filter((r) => !r.ok && /out of stock|Only/.test(r.message)).length, 3);
  assert.equal(stock(vid), 0);
  // and the same idempotency key racing against itself still makes one order
  const key = uuid(); const v2 = V(turmeric, '100g'); const s0 = stock(v2);
  const same = await Promise.all([1, 2, 3].map(() => rpcAsync('place_order', order([{ variant_id: v2, quantity: 3 }], { idempotency_key: key }, { phone: '9000000020' }), anon)));
  assert.ok(same.every((r) => r.ok)); assert.equal(new Set(same.map((r) => r.data.order_code)).size, 1);
  assert.equal(stock(v2), s0 - 3);
});

test('ZONES: disabled zone blocks orders; a PIN cannot sit in two active zones', () => {
  rejects(() => rpc('admin_save_zone', { name: 'Clash', pin_codes: '742133', delivery_charge: 10 }, owner), /already uses/);
  rejects(() => rpc('admin_save_zone', { name: 'Bad', pin_codes: '12345' }, owner), /valid 6-digit/);
  rejects(() => rpc('admin_save_zone', { name: 'Bad', pin_codes: '742999', delivery_charge: -5 }, owner), /check the zone/);
  const z2 = rpc('admin_save_zone', { name: 'Far', pin_codes: '742201', delivery_charge: 80, min_order_value: 0 }, owner);
  const it = [{ variant_id: V(turmeric, '100g'), quantity: 1 }];
  const r = rpc('place_order', order(it, {}, { pin: '742201', phone: '9000000030' }), anon);
  assert.equal(r.delivery_charge, 80); assert.equal(r.total, 120);
  rpc('admin_save_zone', { id: z2.id, name: 'Far', pin_codes: '742201', delivery_charge: 80, is_active: false }, owner);
  rejects(() => rpc('place_order', order(it, {}, { pin: '742201', phone: '9000000031' }), anon), /do not deliver/);
  rpc('admin_delete_zone', { p_id: z2.id }, owner);
  assert.equal(sql(`select delivery_zone_name from orders where order_code='${r.order_code}'`), 'Far');   // history keeps the name
});

test('STATUS + CANCELLATION: forward-only, stock restored exactly once, history recorded', () => {
  const vid = V(turmeric, '100g'); const s0 = stock(vid);
  const r = rpc('place_order', order([{ variant_id: vid, quantity: 3 }], {}, { phone: '9000000040' }), anon);
  const id = sql(`select id from orders where order_code='${r.order_code}'`);
  assert.equal(stock(vid), s0 - 3);
  let o = rpc('admin_update_order_status', { p_id: id, p_status: 'confirmed', p_note: 'Called customer' }, owner);
  assert.equal(o.status, 'confirmed');
  rejects(() => rpc('admin_update_order_status', { p_id: id, p_status: 'confirmed' }, owner), /already/);
  o = rpc('admin_update_order_status', { p_id: id, p_status: 'processing' }, owner);
  rejects(() => rpc('admin_update_order_status', { p_id: id, p_status: 'pending' }, owner), /earlier status/);
  rejects(() => rpc('admin_update_order_status', { p_id: id, p_status: 'bogus' }, owner), /Unknown status/);
  o = rpc('admin_update_order_status', { p_id: id, p_status: 'cancelled', p_note: 'Customer asked' }, owner);
  assert.equal(o.status, 'cancelled'); assert.equal(o.stock_deducted, false);
  assert.equal(stock(vid), s0);                                   // restored once
  rejects(() => rpc('admin_update_order_status', { p_id: id, p_status: 'cancelled' }, owner), /already|cannot be changed/);
  rejects(() => rpc('admin_update_order_status', { p_id: id, p_status: 'confirmed' }, owner), /cannot be changed/);
  assert.equal(stock(vid), s0);                                   // still only once
  assert.deepEqual(o.history.map((h) => h.to_status), ['pending', 'confirmed', 'processing', 'cancelled']);
  assert.ok(o.history.every((h) => h.at));
  // delivered orders cannot be cancelled
  const r2 = rpc('place_order', order([{ variant_id: V(turmeric, '100g'), quantity: 3 }], {}, { phone: '9000000041' }), anon);
  const id2 = sql(`select id from orders where order_code='${r2.order_code}'`);
  for (const st of ['confirmed', 'out_for_delivery', 'delivered']) rpc('admin_update_order_status', { p_id: id2, p_status: st }, owner);
  rejects(() => rpc('admin_update_order_status', { p_id: id2, p_status: 'cancelled' }, owner), /cannot be changed/);
});

test('TRACKING: needs order code AND matching phone; guessing is blocked', () => {
  const r = rpc('place_order', order([{ variant_id: V(turmeric, '100g'), quantity: 3 }], {}, { phone: '9000000050', name: 'Track Me' }), anon);
  const ok = rpc('track_order', { p_code: r.order_code.toLowerCase(), p_phone: '+91 90000 00050' }, anon);
  assert.equal(ok.found, true); assert.equal(ok.status, 'pending'); assert.equal(ok.total, 150);
  assert.equal(ok.items[0].variant_label, '100g'); assert.equal(ok.history.length, 1);
  assert.ok(!JSON.stringify(ok).includes('9000000050'));          // no phone echoed
  assert.equal(rpc('track_order', { p_code: r.order_code, p_phone: '9111111111' }, anon).found, false);   // wrong phone
  assert.equal(rpc('track_order', { p_code: 'MMB-AAAAAAAA', p_phone: '9000000050' }, anon).found, false); // wrong code
  rejects(() => rpc('track_order', { p_code: r.order_code, p_phone: '123' }, anon), /10-digit/);
  rejects(() => rpc('track_order', { p_code: '', p_phone: '9000000050' }, anon), /order ID/);
  // brute force on one code: after 8 wrong tries even the right phone is paused
  for (let i = 0; i < 7; i++) rpc('track_order', { p_code: r.order_code, p_phone: '9222222' + String(100 + i) }, anon);
  rejects(() => rpc('track_order', { p_code: r.order_code, p_phone: '9000000050' }, anon), /Too many attempts/);
  sql(`delete from tracking_attempts`);
  assert.equal(rpc('track_order', { p_code: r.order_code, p_phone: '9000000050' }, anon).found, true);
});

test('NOTIFICATIONS: queued after the order is saved, following the owner settings', () => {
  sql(`delete from notification_logs`);
  // nothing configured: owner rows are SKIPPED with a reason, order still saved
  const r1 = rpc('place_order', order([{ variant_id: V(turmeric, '100g'), quantity: 3 }], {}, { phone: '9000000060' }), anon);
  let rows = sql(`select channel||'/'||recipient_type||'/'||event||'/'||status from notification_logs order by 1`).split('\n');
  assert.deepEqual(rows, ['email/owner/order_placed/skipped', 'whatsapp/customer/order_placed/queued', 'whatsapp/owner/order_placed/skipped']);
  assert.match(sql(`select last_error from notification_logs where channel='email' and recipient_type='owner'`), /not set/);
  // configure
  rpc('admin_save_notification_settings', { owner_email: 'owner@example.com', owner_whatsapp: '+91 98000 11122', email_from: 'Shop <orders@shop.example>' }, owner);
  const r2 = rpc('place_order', order([{ variant_id: V(turmeric, '100g'), quantity: 3 }], {}, { phone: '9000000061', email: 'cust@example.com' }), anon);
  rows = sql(`select n.channel||'/'||n.recipient_type||'/'||n.status||'/'||coalesce(n.recipient,'') from notification_logs n join orders o on o.id=n.order_id where o.order_code='${r2.order_code}' order by 1`).split('\n');
  assert.deepEqual(rows, ['email/customer/queued/cust@example.com', 'email/owner/queued/owner@example.com', 'whatsapp/customer/queued/919000000061', 'whatsapp/owner/queued/919800011122']);
  // toggles
  rpc('admin_save_notification_settings', { owner_email: 'owner@example.com', owner_whatsapp: '9800011122', owner_email_enabled: false, customer_whatsapp_enabled: false, customer_email_enabled: true, owner_whatsapp_enabled: true }, owner);
  const r3 = rpc('place_order', order([{ variant_id: V(turmeric, '100g'), quantity: 3 }], {}, { phone: '9000000062', email: 'c3@example.com' }), anon);
  rows = sql(`select n.channel||'/'||n.recipient_type from notification_logs n join orders o on o.id=n.order_id where o.order_code='${r3.order_code}' order by 1`).split('\n');
  assert.deepEqual(rows, ['email/customer', 'whatsapp/owner']);
  rejects(() => rpc('admin_save_notification_settings', { owner_whatsapp: '123' }, owner), /10-digit/);
  rejects(() => rpc('admin_save_notification_settings', { owner_email: 'bad' }, owner), /email/);
  // status changes queue customer messages (once per event)
  rpc('admin_save_notification_settings', { owner_email: 'owner@example.com', owner_whatsapp: '9800011122', customer_whatsapp_enabled: true, customer_email_enabled: true }, owner);
  const id = sql(`select id from orders where order_code='${r2.order_code}'`);
  rpc('admin_update_order_status', { p_id: id, p_status: 'confirmed' }, owner);
  rpc('admin_update_order_status', { p_id: id, p_status: 'processing' }, owner);       // no customer message for "processing"
  rpc('admin_update_order_status', { p_id: id, p_status: 'out_for_delivery' }, owner);
  rpc('admin_update_order_status', { p_id: id, p_status: 'delivered' }, owner);
  const ev = sql(`select event from notification_logs where order_id='${id}' and recipient_type='customer' and channel='email' order by created_at`).split('\n');
  assert.deepEqual(ev, ['order_placed', 'confirmed', 'out_for_delivery', 'delivered']);
  assert.equal(sql(`select count(*) from notification_logs where order_id='${id}' and recipient_type='owner' and event<>'order_placed'`), '0');
});

test('NOTIFICATION WORKER: claim, retry with back-off, permanent failure, success, requeue', () => {
  sql(`delete from notification_logs`);
  rpc('admin_save_notification_settings', { owner_email: 'owner@example.com', owner_whatsapp: '9800011122', owner_email_enabled: true, owner_whatsapp_enabled: true, customer_email_enabled: true, customer_whatsapp_enabled: true }, owner);
  const r = rpc('place_order', order([{ variant_id: V(turmeric, '100g'), quantity: 3 }], {}, { phone: '9000000070', email: 'w@example.com' }), anon);
  const claim = rpc('claim_notifications', { p_limit: 10 }, svc);
  assert.equal(claim.messages.length, 4);
  const m = claim.messages.find((x) => x.channel === 'email' && x.recipient_type === 'owner');
  assert.equal(m.order.order_code, r.order_code); assert.equal(m.order.total, 150); assert.equal(m.order.items[0].variant_label, '100g');
  assert.equal(claim.settings.shop_name, 'Mandal Masala Bhandar');
  assert.equal(rpc('claim_notifications', { p_limit: 10 }, svc).messages.length, 0);   // already leased
  rpc('finish_notification', { p_id: m.id, p_outcome: 'failed', p_error: 'timeout' }, svc);
  assert.match(sql(`select status||'|'||attempts||'|'||last_error from notification_logs where id='${m.id}'`), /^failed\|1\|timeout$/);
  assert.equal(rpc('claim_notifications', {}, svc).messages.length, 0);                 // back-off: not due yet
  sql(`update notification_logs set next_attempt_at = now() - interval '1 second' where id='${m.id}'`);
  assert.equal(rpc('claim_notifications', {}, svc).messages.length, 1);                 // due again
  rpc('finish_notification', { p_id: m.id, p_outcome: 'failed', p_error: 'bad number', p_permanent: true }, svc);
  sql(`update notification_logs set next_attempt_at = now() - interval '1 second'`);
  assert.equal(rpc('claim_notifications', {}, svc).messages.length, 0);                 // permanent => no retry
  for (const x of claim.messages.filter((y) => y.id !== m.id)) rpc('finish_notification', { p_id: x.id, p_outcome: 'sent', p_provider_id: 'wamid.1' }, svc);
  assert.equal(sql(`select count(*) from notification_logs where status='sent' and sent_at is not null`), '3');
  assert.equal(rpc('admin_dashboard', {}, owner).failed_notifications, 1);
  rpc('admin_requeue_notification', { p_id: m.id }, owner);
  assert.equal(rpc('claim_notifications', {}, svc).messages.length, 1);
  // a crashed worker's lease expires and the message is picked up again
  sql(`update notification_logs set locked_until = now() - interval '1 second' where id='${m.id}'`);
  assert.equal(rpc('claim_notifications', {}, svc).messages.length, 1);
  assert.equal(rpc('admin_list_notifications', {}, owner).length >= 4, true);
  // order untouched by failures
  assert.equal(sql(`select status from orders where order_code='${r.order_code}'`), 'pending');
});

test('ADMIN: categories, products, variants, delete rules', () => {
  const c = rpc('admin_save_category', { name: 'Tea & Others', description: 'x' }, owner);
  assert.equal(c.slug, 'tea-others');
  rejects(() => rpc('admin_save_category', { name: 'tea & others' }, owner), /already exists/);
  const upd = rpc('admin_save_category', { id: c.id, name: 'Tea', is_active: false }, owner);
  assert.equal(upd.name, 'Tea');
  const p = rpc('admin_save_product', { category_id: c.id, name: 'Green Tea', variants: [{ label: '100g', price: 120, stock_qty: 4 }, { label: '250g', price: 280, stock_qty: 2 }] }, owner);
  rejects(() => rpc('admin_delete_category', { p_id: c.id }, owner), /still has products/);
  rejects(() => rpc('admin_save_product', { id: p.id, category_id: c.id, name: 'Green Tea', variants: [{ label: '100g', price: 100 }] }, owner).x, /x/);   // duplicate label (new row) -> error
  rejects(() => rpc('admin_save_product', { category_id: c.id, name: 'Bad', variants: [{ label: '1kg', price: 0 }] }, owner), /above 0/);
  rejects(() => rpc('admin_save_product', { category_id: c.id, name: 'Bad2', variants: [{ label: '1kg', price: 50, compare_at_price: 40 }] }, owner), /old \(crossed-out\) price/);
  rejects(() => rpc('admin_save_product', { category_id: c.id, name: 'Bad3', variants: [{ label: '1kg', price: 50, stock_qty: -1 }] }, owner), /negative|check/);
  // edit one pack size independently, add another, remove another
  const rm = p.variants.find((v) => v.label === '250g').id; const keep = p.variants.find((v) => v.label === '100g').id;
  const p2 = rpc('admin_save_product', { id: p.id, category_id: c.id, name: 'Green Tea Premium', is_featured: true, is_best_seller: true,
    variants: [{ id: keep, label: '100g', price: 130, stock_qty: 9 }, { label: '1kg', price: 1000, stock_qty: 1 }], remove_variant_ids: [rm] }, owner);
  assert.equal(p2.name, 'Green Tea Premium'); assert.equal(p2.slug, 'green-tea');
  assert.deepEqual(p2.variants.map((v) => v.label).sort(), ['100g', '1kg']);
  assert.equal(p2.variants.find((v) => v.label === '100g').price, 130);
  // past orders keep their copy even when product/variant are deleted
  rpc('admin_save_category', { id: c.id, name: 'Tea', is_active: true }, owner);
  rpc('admin_save_zone', { name: 'Tmp', pin_codes: '742500', delivery_charge: 0 }, owner);
  const o = rpc('place_order', order([{ variant_id: V(p2, '100g'), quantity: 1 }], {}, { pin: '742500', phone: '9000000080' }), anon);
  rpc('admin_delete_product', { p_id: p.id }, owner);
  assert.equal(sql(`select count(*) from order_items i join orders od on od.id=i.order_id where od.order_code='${o.order_code}' and product_name='Green Tea Premium' and variant_id is null`), '1');
  assert.equal(rpc('admin_delete_category', { p_id: c.id }, owner).ok, true);
});

test('ADMIN: order search / filters, dashboard and sales report', () => {
  const all = rpc('admin_list_orders', {}, owner); assert.ok(all.total > 10);
  assert.equal(rpc('admin_list_orders', { search: '9000000050' }, owner).total, 1);
  assert.equal(rpc('admin_list_orders', { search: 'Track Me' }, owner).total, 1);
  const code = all.orders[0].order_code;
  assert.equal(rpc('admin_list_orders', { search: code.slice(4, 9) }, owner).orders[0].order_code, code);
  assert.ok(rpc('admin_list_orders', { status: 'cancelled' }, owner).orders.every((o) => o.status === 'cancelled'));
  const today = sql(`select (now() at time zone 'Asia/Kolkata')::date`);
  assert.equal(rpc('admin_list_orders', { from: today, to: today }, owner).total, all.total);
  assert.equal(rpc('admin_list_orders', { from: '2020-01-01', to: '2020-01-02' }, owner).total, 0);
  assert.equal(rpc('admin_list_orders', { limit: 2 }, owner).orders.length, 2);
  assert.ok(all.orders[0].items_summary.includes('x'));
  const d = rpc('admin_dashboard', {}, owner);
  assert.equal(d.total_orders, all.total);
  assert.equal(d.todays_orders, all.total);
  assert.equal(Number(d.total_sales), Number(sql(`select sum(total) from orders where status<>'cancelled'`)));
  assert.equal(d.pending_orders + d.in_progress_orders + d.completed_orders + d.cancelled_orders, d.total_orders);
  assert.ok(d.low_stock.some((x) => x.product_name === 'Turmeric Powder' && x.label === '500g'));
  assert.ok(d.recent_orders.length > 0);
  for (const g of ['day', 'week', 'month']) {
    const rep = rpc('admin_sales_report', { group: g }, owner);
    assert.equal(rep.series.reduce((a, x) => a + Number(x.sales), 0), Number(d.total_sales));
    assert.equal(rep.totals.orders, d.total_orders - d.cancelled_orders);
    assert.equal(rep.totals.cod_orders, rep.totals.orders);
  }
  const rep = rpc('admin_sales_report', {}, owner);
  assert.equal(rep.best_sellers[0].product_name, 'Turmeric Powder');
  rejects(() => rpc('admin_sales_report', { group: 'year' }, owner), /Unknown grouping/);
  rejects(() => rpc('admin_sales_report', { from: '2026-02-02', to: '2026-01-01' }, owner), /before/);
});

test('SETTINGS: owner edits shop details; public sees them and delivery areas, not private notification data', () => {
  rpc('admin_save_store_settings', { shop_name: 'Mandal Masala Bhandar', contact_phone: '9800000000', announcement: 'Open on Sundays', low_stock_threshold: 3 }, owner);
  const info = rpc('get_store_info', {}, anon);
  assert.equal(info.contact_phone, '9800000000'); assert.equal(info.announcement, 'Open on Sundays');
  assert.ok(info.delivery_zones.some((z) => z.name === 'Beldanga Town'));
  assert.ok(!('owner_email' in info) && !JSON.stringify(info).includes('owner@example.com'));
  rejects(() => rpc('admin_save_store_settings', { low_stock_threshold: -1 }, owner), /negative/);
  assert.equal(rpc('admin_get_settings', {}, owner).notifications.owner_email, 'owner@example.com');
});

test('STORAGE: only the owner may upload product images (policy check)', () => {
  const pol = sql(`select policyname from pg_policies where schemaname='storage' and tablename='objects' order by 1`).split('\n');
  assert.equal(pol.length, 4);
  rejects(() => sql(`insert into storage.objects(bucket_id,name) values ('product-images','x.jpg')`, stranger), /permission denied|row-level/);
});
