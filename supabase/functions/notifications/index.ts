// =====================================================================
// Mandal Masala Bhandar  |  Edge Function: "notifications"
//
// Sends the e-mails (Resend) and WhatsApp messages (WhatsApp Business Cloud API)
// that the database has queued in the notification_logs table.
//
//  * The ORDER is always saved first. This function only sends afterwards,
//    so if Resend / WhatsApp is down, nothing is lost: the message is retried.
//  * API keys live ONLY in this function's secrets. Never in the website, never in the database.
//  * ONE file, no imports, so it can be pasted into the Supabase dashboard editor.
//
// Actions (POST, JSON body):
//   { "action": "drain" }                         anyone may call: sends whatever is due (cannot be used to send custom text)
//   { "action": "status" }                        owner only: which services are configured
//   { "action": "test", "channel": "email"|"whatsapp", "to": "..." }   owner only: sends a test message
//
// Secrets (Supabase Dashboard -> Edge Functions -> Secrets):
//   RESEND_API_KEY, EMAIL_FROM (optional), WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, SITE_URL
//   (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically.)
// =====================================================================

type Env = Record<string, string | undefined>;
type Json = Record<string, any>;
export interface Ctx { env: Env; fetch: typeof fetch }

const MAX_ATTEMPTS = 5;

// ---------------------------------------------------------------- helpers
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const money = (n: unknown) => 'Rs. ' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
const STATUS_TEXT: Record<string, string> = { order_placed: 'Received', confirmed: 'Confirmed', out_for_delivery: 'Out for delivery', delivered: 'Delivered', cancelled: 'Cancelled' };

/** WhatsApp template values may not contain new lines, tabs or 5+ spaces, and must not be empty. */
const waText = (v: unknown, max = 900) => (String(v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, max) || '-');

const itemsLine = (o: Json) => (o.items || []).map((i: Json) => `${i.product_name} (${i.variant_label}) x ${i.quantity}`).join(', ');
const siteUrl = (env: Env) => (env.SITE_URL || '').replace(/\/+$/, '');
const trackUrl = (env: Env, o: Json) => (siteUrl(env) ? `${siteUrl(env)}/track?code=${encodeURIComponent(o.order_code)}` : '');

// ---------------------------------------------------------------- e-mail content
function emailShell(shop: string, title: string, bodyHtml: string) {
  return `<!doctype html><html><body style="margin:0;background:#FAF6F2;font-family:Arial,Helvetica,sans-serif;color:#3A271D">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:16px">
<table width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden" cellpadding="0" cellspacing="0">
<tr><td style="background:#842419;color:#FFF0BF;padding:18px 22px;font-size:20px;font-weight:bold">${esc(shop)}</td></tr>
<tr><td style="padding:22px"><h2 style="margin:0 0 12px;font-size:20px;color:#842419">${esc(title)}</h2>${bodyHtml}</td></tr>
<tr><td style="padding:14px 22px;background:#F1E9E0;font-size:12px;color:#6E4C3A">This is an automatic message from ${esc(shop)}.</td></tr>
</table></td></tr></table></body></html>`;
}

function orderTable(o: Json) {
  const rows = (o.items || []).map((i: Json) => `<tr><td style="padding:6px 0;border-bottom:1px solid #eee">${esc(i.product_name)} <span style="color:#6E4C3A">(${esc(i.variant_label)})</span></td><td style="padding:6px 8px;border-bottom:1px solid #eee" align="center">x ${esc(i.quantity)}</td><td style="padding:6px 0;border-bottom:1px solid #eee" align="right">${esc(money(i.line_total))}</td></tr>`).join('');
  return `<table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px">${rows}
<tr><td colspan="2" style="padding:6px 0">Subtotal</td><td align="right">${esc(money(o.subtotal))}</td></tr>
<tr><td colspan="2" style="padding:6px 0">Delivery</td><td align="right">${Number(o.delivery_charge) ? esc(money(o.delivery_charge)) : 'Free'}</td></tr>
<tr><td colspan="2" style="padding:8px 0;font-weight:bold;font-size:16px">Total to pay (Cash on Delivery)</td><td align="right" style="font-weight:bold;font-size:16px">${esc(money(o.total))}</td></tr></table>`;
}

export function buildEmail(m: Json, s: Json, env: Env): { to: string; subject: string; html: string; text: string } {
  const o = m.order as Json; const shop = s.shop_name || 'Mandal Masala Bhandar'; const track = trackUrl(env, o);
  if (m.recipient_type === 'owner') {
    const subject = `New order ${o.order_code} - ${money(o.total)} (COD)`;
    const html = emailShell(shop, `New order ${o.order_code}`, `
      <p style="margin:0 0 12px;font-size:14px"><b>${esc(o.customer_name)}</b> placed an order on ${esc(when(o.created_at))}.</p>
      <p style="margin:0 0 12px;font-size:14px">Phone: <a href="tel:+91${esc(o.customer_phone)}">${esc(o.customer_phone)}</a><br>
      Address: ${esc(o.address)}${o.notes ? `<br>Notes: ${esc(o.notes)}` : ''}</p>${orderTable(o)}
      <p style="font-size:13px;color:#6E4C3A">Open your admin panel to confirm the order.</p>`);
    const text = `New order ${o.order_code}\n${o.customer_name}, ${o.customer_phone}\n${o.address}\n${o.notes ? 'Notes: ' + o.notes + '\n' : ''}\n${itemsLine(o)}\nSubtotal ${money(o.subtotal)}, delivery ${money(o.delivery_charge)}\nTotal (COD): ${money(o.total)}\nPlaced: ${when(o.created_at)}`;
    return { to: m.recipient, subject, html, text };
  }
  const lead: Record<string, [string, string]> = {
    order_placed: [`Order ${o.order_code} received`, 'Thank you for your order! We have received it and will confirm it shortly.'],
    confirmed: [`Order ${o.order_code} confirmed`, 'Good news: your order is confirmed and is being prepared.'],
    out_for_delivery: [`Order ${o.order_code} is out for delivery`, 'Your order is on its way. Please keep the cash ready.'],
    delivered: [`Order ${o.order_code} delivered`, 'Your order has been delivered. Thank you for shopping with us!'],
    cancelled: [`Order ${o.order_code} cancelled`, 'Your order has been cancelled. If you did not ask for this, please contact the shop.'],
  };
  const [title, line] = lead[m.event] || [`Order ${o.order_code} update`, `Your order status is now ${STATUS_TEXT[m.event] || m.event}.`];
  const detail = m.event === 'order_placed' || m.event === 'confirmed' ? orderTable(o) + `<p style="font-size:14px">Delivery address:<br>${esc(o.address)}</p>` : `<p style="font-size:14px">Order total: <b>${esc(money(o.total))}</b> (Cash on Delivery)</p>`;
  const trackHtml = track
    ? `<p style="font-size:14px">Track your order: <a href="${esc(track)}">${esc(track)}</a><br>Order ID: <b>${esc(o.order_code)}</b> &middot; use the mobile number you gave at checkout.</p>`
    : `<p style="font-size:14px">Order ID: <b>${esc(o.order_code)}</b>. You can track your order on our website with this ID and your mobile number.</p>`;
  const html = emailShell(shop, title, `<p style="font-size:15px;margin:0 0 12px">Hello ${esc(o.customer_name)},<br>${esc(line)}</p>${detail}${trackHtml}${s.shop_phone ? `<p style="font-size:13px;color:#6E4C3A">Questions? Call us on ${esc(s.shop_phone)}.</p>` : ''}`);
  const text = `Hello ${o.customer_name},\n${line}\n\nOrder ID: ${o.order_code}\n${itemsLine(o)}\nTotal (Cash on Delivery): ${money(o.total)}\nDelivery address: ${o.address}\n${track ? 'Track: ' + track + '\n' : ''}`;
  return { to: m.recipient, subject: `${title} - ${shop}`, html, text };
}

// ---------------------------------------------------------------- WhatsApp content
export function buildWhatsApp(m: Json, s: Json): { to: string; template: string; language: string; params: string[] } {
  const o = m.order as Json; const lang = s.wa_template_language || 'en';
  if (m.recipient_type === 'owner') {
    return { to: m.recipient, template: s.wa_template_owner_new, language: lang,
      params: [o.order_code, o.customer_name, o.customer_phone, itemsLine(o), money(o.total), o.address].map((v) => waText(v)) };
  }
  if (m.event === 'order_placed') {
    return { to: m.recipient, template: s.wa_template_customer_confirm, language: lang, params: [o.customer_name, o.order_code, money(o.total)].map((v) => waText(v)) };
  }
  return { to: m.recipient, template: s.wa_template_customer_status, language: lang,
    params: [o.customer_name, o.order_code, STATUS_TEXT[m.event] || m.event].map((v) => waText(v)) };
}

// ---------------------------------------------------------------- providers
class SendError extends Error {
  permanent: boolean;
  constructor(msg: string, permanent: boolean) { super(msg); this.permanent = permanent; }
}

async function timedFetch(ctx: Ctx, url: string, init: RequestInit) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 12000);
  try { return await ctx.fetch(url, { ...init, signal: ac.signal }); } catch (e) { throw new SendError('Network problem: ' + (e as Error).message, false); } finally { clearTimeout(t); }
}

export const emailConfigured = (env: Env) => !!env.RESEND_API_KEY;
export const whatsappConfigured = (env: Env) => !!(env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID);

async function sendEmail(ctx: Ctx, from: string, mail: { to: string; subject: string; html: string; text: string }): Promise<string> {
  const res = await timedFetch(ctx, (ctx.env.RESEND_API_URL || 'https://api.resend.com') + '/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${ctx.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, html: mail.html, text: mail.text }) });
  const body: Json = await res.json().catch(() => ({}));
  if (res.ok) return String(body.id || '');
  const msg = `Resend ${res.status}: ${body.message || body.error || 'request failed'}`;
  throw new SendError(msg, res.status < 500 && res.status !== 429);
}

async function sendWhatsApp(ctx: Ctx, w: { to: string; template: string; language: string; params: string[] }): Promise<string> {
  const base = ctx.env.WHATSAPP_API_URL || 'https://graph.facebook.com/v21.0';
  const res = await timedFetch(ctx, `${base}/${ctx.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST', headers: { Authorization: `Bearer ${ctx.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: w.to, type: 'template',
      template: { name: w.template, language: { code: w.language },
        components: w.params.length ? [{ type: 'body', parameters: w.params.map((text) => ({ type: 'text', text })) }] : [] } }) });
  const body: Json = await res.json().catch(() => ({}));
  if (res.ok) return String(body.messages?.[0]?.id || '');
  const e = body.error || {};
  const msg = `WhatsApp ${res.status}${e.code ? ' (code ' + e.code + ')' : ''}: ${e.error_data?.details || e.message || 'request failed'}`;
  throw new SendError(msg, res.status < 500 && res.status !== 429);
}

// ---------------------------------------------------------------- Supabase access (plain REST, service role)
async function rpc(ctx: Ctx, fn: string, args: Json, key?: string, bearer?: string) {
  const url = `${ctx.env.SUPABASE_URL}/rest/v1/rpc/${fn}`;
  const k = key || ctx.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const res = await ctx.fetch(url, { method: 'POST', headers: { apikey: k, Authorization: `Bearer ${bearer || k}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  const text = await res.text();
  if (!res.ok) throw new Error(`database ${fn} failed (${res.status}): ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function isOwner(ctx: Ctx, req: Request): Promise<boolean> {
  const auth = req.headers.get('authorization') || '';
  if (!/^Bearer\s+\S+/i.test(auth)) return false;
  try {
    const anon = ctx.env.SUPABASE_ANON_KEY || req.headers.get('apikey') || '';
    return (await rpc(ctx, 'is_admin', {}, anon, auth.replace(/^Bearer\s+/i, ''))) === true;
  } catch { return false; }
}

// ---------------------------------------------------------------- the worker
export async function drain(ctx: Ctx, limit = 10) {
  const claim = await rpc(ctx, 'claim_notifications', { p_limit: limit });
  const s: Json = claim.settings || {};
  const out = { processed: 0, sent: 0, failed: 0, skipped: 0 };
  for (const m of claim.messages as Json[]) {
    out.processed++;
    const done = (outcome: string, error?: string, id?: string, permanent = false) =>
      rpc(ctx, 'finish_notification', { p_id: m.id, p_outcome: outcome, p_error: error ?? null, p_provider_id: id ?? null, p_permanent: permanent });
    try {
      if (m.channel === 'email') {
        if (!emailConfigured(ctx.env)) { await done('skipped', 'Email is not set up yet: the RESEND_API_KEY secret is missing.'); out.skipped++; continue; }
        if (!m.recipient) { await done('skipped', 'No email address.'); out.skipped++; continue; }
        const from = s.email_from || ctx.env.EMAIL_FROM || `${s.shop_name || 'Mandal Masala Bhandar'} <onboarding@resend.dev>`;
        const id = await sendEmail(ctx, from, buildEmail(m, s, ctx.env));
        await done('sent', undefined, id); out.sent++;
      } else {
        if (!whatsappConfigured(ctx.env)) { await done('skipped', 'WhatsApp is not set up yet: WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID secrets are missing.'); out.skipped++; continue; }
        if (!m.recipient) { await done('skipped', 'No phone number.'); out.skipped++; continue; }
        const w = buildWhatsApp(m, s);
        if (!w.template) { await done('skipped', 'No WhatsApp template name set in Notification Settings.'); out.skipped++; continue; }
        const id = await sendWhatsApp(ctx, w);
        await done('sent', undefined, id); out.sent++;
      }
    } catch (e) {
      const permanent = e instanceof SendError ? e.permanent : false;
      try { await done('failed', (e as Error).message, undefined, permanent); } catch { /* lease will expire and it is retried */ }
      out.failed++;
    }
  }
  return out;
}

// ---------------------------------------------------------------- HTTP handler
export function createHandler(ctx: Ctx) {
  const cors = { 'Access-Control-Allow-Origin': ctx.env.ALLOWED_ORIGIN || '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  const reply = (status: number, body: Json) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return reply(405, { error: 'POST only' });
    let body: Json = {};
    try { body = await req.json(); } catch { return reply(400, { error: 'Invalid JSON' }); }
    try {
      switch (body.action) {
        case 'drain': return reply(200, await drain(ctx));
        case 'status': {
          if (!(await isOwner(ctx, req))) return reply(403, { error: 'Owner only' });
          return reply(200, {
            email: { configured: emailConfigured(ctx.env), provider: 'Resend', default_from: ctx.env.EMAIL_FROM || null, missing: emailConfigured(ctx.env) ? [] : ['RESEND_API_KEY'] },
            whatsapp: { configured: whatsappConfigured(ctx.env), provider: 'WhatsApp Business Cloud API', missing: ['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'].filter((k) => !ctx.env[k]) },
            site_url: ctx.env.SITE_URL || null });
        }
        case 'test': {
          if (!(await isOwner(ctx, req))) return reply(403, { error: 'Owner only' });
          const to = String(body.to || '').trim();
          if (body.channel === 'email') {
            if (!emailConfigured(ctx.env)) return reply(200, { ok: false, error: 'RESEND_API_KEY secret is not set.' });
            if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return reply(200, { ok: false, error: 'Enter a valid email address to send the test to.' });
            const from = String(body.from || ctx.env.EMAIL_FROM || 'Mandal Masala Bhandar <onboarding@resend.dev>');
            const id = await sendEmail(ctx, from, { to, subject: 'Test email from your shop website', text: 'This is a test. Your email notifications are working.', html: emailShell('Mandal Masala Bhandar', 'Test email', '<p>This is a test. Your email notifications are working.</p>') }).catch((e) => { throw e; });
            return reply(200, { ok: true, id });
          }
          if (body.channel === 'whatsapp') {
            if (!whatsappConfigured(ctx.env)) return reply(200, { ok: false, error: 'WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID secrets are not set.' });
            const digits = to.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
            if (!/^[6-9]\d{9}$/.test(digits)) return reply(200, { ok: false, error: 'Enter a valid 10-digit mobile number.' });
            // "hello_world" is the sample template every WhatsApp Cloud API number starts with
            const id = await sendWhatsApp(ctx, { to: '91' + digits, template: 'hello_world', language: 'en_US', params: [] });
            return reply(200, { ok: true, id });
          }
          return reply(400, { error: 'channel must be email or whatsapp' });
        }
        default: return reply(400, { error: 'Unknown action' });
      }
    } catch (e) {
      if (e instanceof SendError) return reply(200, { ok: false, error: e.message });
      return reply(500, { error: 'Something went wrong while sending. The order is safe; messages will be retried.' });
    }
  };
}

// ---------------------------------------------------------------- start (Supabase / Deno)
declare const Deno: any;
if (typeof Deno !== 'undefined' && Deno.serve) {
  Deno.serve(createHandler({ env: Deno.env.toObject(), fetch }));
}
