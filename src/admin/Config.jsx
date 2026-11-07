import { useState } from 'react';
import { adminRpc, notifyAdmin, drainNotifications } from '../lib/api.js';
import { useAsync, money, fmtDate, fmtDay, toCsv, download } from '../lib/util.js';
import { Field, Switch, Modal, Empty } from '../components/ui.jsx';
import { Page, Load, useAction } from './ui.jsx';

// ------------------------------------------------------------------ delivery zones
export function Delivery() {
  const st = useAsync(() => adminRpc('admin_list_zones'));
  const [edit, setEdit] = useState(null);
  const [busy, run] = useAction();
  const blank = { name: '', pin_codes: '', delivery_charge: '', min_order_value: '', free_delivery_threshold: '', is_active: true };
  const save = async (e) => {
    e.preventDefault();
    const p = { ...edit, delivery_charge: edit.delivery_charge === '' ? 0 : Number(edit.delivery_charge), min_order_value: edit.min_order_value === '' ? 0 : Number(edit.min_order_value), free_delivery_threshold: edit.free_delivery_threshold === '' ? null : Number(edit.free_delivery_threshold), pin_codes: Array.isArray(edit.pin_codes) ? edit.pin_codes.join(', ') : edit.pin_codes };
    const r = await run(() => adminRpc('admin_save_zone', { p }), 'Delivery area saved');
    if (r.ok) { setEdit(null); st.reload(); }
  };
  const toggle = (z) => run(async () => { await adminRpc('admin_save_zone', { p: { ...z, pin_codes: z.pin_codes.join(', ') } }); st.reload(); }).then(() => 0);
  const del = (z) => { if (confirm(`Delete the delivery area "${z.name}"? Customers in these PIN codes will no longer be able to order.`)) run(async () => { await adminRpc('admin_delete_zone', { p_id: z.id }); st.reload(); }, 'Delivery area deleted'); };
  return (
    <Page title="Delivery areas" actions={<button className="btn btn-primary btn-small" onClick={() => setEdit(blank)}>+ Add delivery area</button>}>
      <p className="muted">Customers can only order if their PIN code is in an active delivery area. You decide the areas, charges and minimum order. Nothing is pre-filled.</p>
      <Load state={st}>{(list) => list.length === 0 ? <Empty title="No delivery areas yet">Customers cannot place orders until you add at least one area.<div><button className="btn btn-primary" onClick={() => setEdit(blank)}>+ Add delivery area</button></div></Empty> : (
        <div className="card table-card"><table className="table responsive"><thead><tr><th>Area</th><th>PIN codes</th><th>Charge</th><th>Minimum order</th><th>Free above</th><th>Active</th><th /></tr></thead><tbody>
          {list.map((z) => <tr key={z.id} className={z.is_active ? '' : 'is-off'}><td data-label="Area"><strong>{z.name}</strong></td><td data-label="PIN codes">{z.pin_codes.join(', ')}</td><td data-label="Charge">{money(z.delivery_charge)}</td><td data-label="Minimum order">{z.min_order_value > 0 ? money(z.min_order_value) : 'None'}</td><td data-label="Free above">{z.free_delivery_threshold != null ? money(z.free_delivery_threshold) : '-'}</td>
            <td data-label="Active"><Switch checked={z.is_active} onChange={(v) => run(async () => { await adminRpc('admin_save_zone', { p: { ...z, pin_codes: z.pin_codes.join(', '), is_active: v } }); st.reload(); }, v ? 'Area enabled' : 'Area disabled')} disabled={busy} /></td>
            <td className="actions"><button className="btn btn-small" onClick={() => setEdit({ ...z, pin_codes: z.pin_codes.join(', '), free_delivery_threshold: z.free_delivery_threshold ?? '' })}>Edit</button> <button className="btn btn-small btn-danger" onClick={() => del(z)} disabled={busy}>Delete</button></td></tr>)}
        </tbody></table></div>
      )}</Load>
      {edit && (
        <Modal title={edit.id ? 'Edit delivery area' : 'Add delivery area'} onClose={() => setEdit(null)}>
          <form onSubmit={save} className="form-grid one">
            <Field label="Area name *"><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} maxLength={60} autoFocus /></Field>
            <Field label="PIN codes *" hint="6-digit PIN codes separated by commas"><textarea rows={2} value={edit.pin_codes} onChange={(e) => setEdit({ ...edit, pin_codes: e.target.value })} /></Field>
            <Field label="Delivery charge (Rs.)"><input inputMode="decimal" value={edit.delivery_charge} onChange={(e) => setEdit({ ...edit, delivery_charge: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
            <Field label="Minimum order value (Rs., optional)"><input inputMode="decimal" value={edit.min_order_value} onChange={(e) => setEdit({ ...edit, min_order_value: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
            <Field label="Free delivery above (Rs., optional)" hint="Leave empty for no free-delivery offer"><input inputMode="decimal" value={edit.free_delivery_threshold} onChange={(e) => setEdit({ ...edit, free_delivery_threshold: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
            <Switch checked={edit.is_active} onChange={(v) => setEdit({ ...edit, is_active: v })} label="Delivering to this area" />
            <div className="form-actions"><button className="btn btn-primary" disabled={busy}>{busy ? 'Saving...' : 'Save'}</button><button type="button" className="btn" onClick={() => setEdit(null)}>Cancel</button></div>
          </form>
        </Modal>
      )}
    </Page>
  );
}

// ------------------------------------------------------------------ sales reports
const iso = (d) => d.toISOString().slice(0, 10);
export function Reports() {
  const today = new Date();
  const [from, setFrom] = useState(iso(new Date(today.getTime() - 29 * 864e5)));
  const [to, setTo] = useState(iso(today));
  const [group, setGroup] = useState('day');
  const st = useAsync(() => adminRpc('admin_sales_report', { p: { from, to, group } }), [from, to, group]);
  const exportCsv = (r) => {
    const rows = [['Period', 'Orders', 'Sales (excl. cancelled)', 'Delivered sales']];
    r.series.forEach((s) => rows.push([s.period, s.orders, s.sales, s.delivered_sales]));
    rows.push([], ['Best selling products'], ['Product', 'Quantity', 'Revenue', 'Orders']);
    r.best_sellers.forEach((b) => rows.push([b.product_name, b.quantity, b.revenue, b.orders]));
    download(`sales-${from}-to-${to}.csv`, toCsv(rows));
  };
  return (
    <Page title="Sales reports">
      <div className="card form-card filters">
        <label className="field"><span className="field-label">From</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="field"><span className="field-label">To</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <label className="field"><span className="field-label">Group by</span><select value={group} onChange={(e) => setGroup(e.target.value)}><option value="day">Daily</option><option value="week">Weekly</option><option value="month">Monthly</option></select></label>
        <div className="quick"><button className="btn btn-small" onClick={() => { setFrom(iso(new Date(Date.now() - 6 * 864e5))); setTo(iso(new Date())); setGroup('day'); }}>Last 7 days</button><button className="btn btn-small" onClick={() => { setFrom(iso(new Date(Date.now() - 29 * 864e5))); setTo(iso(new Date())); setGroup('day'); }}>Last 30 days</button><button className="btn btn-small" onClick={() => { setFrom(iso(new Date(Date.now() - 364 * 864e5))); setTo(iso(new Date())); setGroup('month'); }}>Last 12 months</button></div>
      </div>
      <Load state={st}>{(r) => {
        const max = Math.max(1, ...r.series.map((s) => Number(s.sales)));
        return (
          <>
            <div className="stats">
              <div className="stat"><span>Orders</span><strong>{r.totals.orders}</strong></div>
              <div className="stat wide"><span>Sales (excl. cancelled)</span><strong>{money(r.totals.sales)}</strong></div>
              <div className="stat"><span>COD orders</span><strong>{r.totals.cod_orders}</strong></div>
              <div className="stat"><span>Delivered</span><strong>{r.totals.delivered_orders}</strong></div>
              <div className="stat"><span>Cancelled</span><strong>{r.totals.cancelled_orders}</strong></div>
              <div className="stat"><span>Average order</span><strong>{money(r.totals.average_order)}</strong></div>
            </div>
            <section className="card form-card">
              <div className="sec-head"><h2>{group === 'day' ? 'Daily' : group === 'week' ? 'Weekly' : 'Monthly'} sales</h2><button className="btn btn-small" onClick={() => exportCsv(r)}>Export CSV</button></div>
              <div className="bars" role="img" aria-label="Sales chart">{r.series.map((s) => <div key={s.period} className="bar-col" title={`${fmtDay(s.period)}: ${money(s.sales)} (${s.orders} orders)`}><div className="bar" style={{ height: Math.max(2, (Number(s.sales) / max) * 100) + '%' }} /></div>)}</div>
              <div className="table-scroll"><table className="table"><thead><tr><th>{group === 'day' ? 'Day' : group === 'week' ? 'Week starting' : 'Month'}</th><th>Orders</th><th>Sales</th><th>Delivered sales</th></tr></thead><tbody>
                {[...r.series].reverse().map((s) => <tr key={s.period}><td>{group === 'month' ? new Date(s.period).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) : fmtDay(s.period)}</td><td>{s.orders}</td><td>{money(s.sales)}</td><td>{money(s.delivered_sales)}</td></tr>)}
              </tbody></table></div>
            </section>
            <section className="card form-card"><h2>Best-selling products</h2>
              {r.best_sellers.length === 0 ? <p className="muted">No sales in this period.</p> : <div className="table-scroll"><table className="table"><thead><tr><th>Product</th><th>Quantity sold</th><th>Revenue</th><th>Orders</th></tr></thead><tbody>{r.best_sellers.map((b) => <tr key={b.product_name}><td>{b.product_name}</td><td>{b.quantity}</td><td>{money(b.revenue)}</td><td>{b.orders}</td></tr>)}</tbody></table></div>}
            </section>
          </>
        );
      }}</Load>
    </Page>
  );
}

// ------------------------------------------------------------------ notifications
const Badge = ({ ok, children }) => <span className={'badge ' + (ok ? 'badge-delivered' : 'badge-pending')}>{children}</span>;

export function Notifications() {
  const cfg = useAsync(() => adminRpc('admin_get_settings'));
  const status = useAsync(() => notifyAdmin({ action: 'status' }));
  const logs = useAsync(() => adminRpc('admin_list_notifications', { p: { limit: 60 } }));
  const [busy, run] = useAction();
  const [f, setF] = useState(null);
  const [testTo, setTestTo] = useState({ email: '', whatsapp: '' });
  const [testMsg, setTestMsg] = useState({});
  if (cfg.data && !f) setF({ ...cfg.data.notifications });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  const save = async (e) => {
    e.preventDefault();
    const r = await run(() => adminRpc('admin_save_notification_settings', { p: f }), 'Notification settings saved');
    if (r.ok) setF({ ...r.data });
  };
  const test = async (channel) => {
    setTestMsg((m) => ({ ...m, [channel]: 'Sending...' }));
    const to = testTo[channel] || (channel === 'email' ? f.owner_email : f.owner_whatsapp) || '';
    const r = await run(() => notifyAdmin({ action: 'test', channel, to, ...(channel === 'email' && f.email_from ? { from: f.email_from } : {}) }));
    setTestMsg((m) => ({ ...m, [channel]: r.ok ? (r.data.ok ? 'Test message sent. Please check your ' + (channel === 'email' ? 'inbox (and spam)' : 'WhatsApp') + '.' : 'Not sent: ' + r.data.error) : 'Failed: ' + r.error.message }));
  };
  const sendNow = () => run(async () => { const r = await drainNotifications(); await logs.reload(); return r; }, 'Queued messages processed');
  const retry = (n) => run(async () => { await adminRpc('admin_requeue_notification', { p_id: n.id }); await drainNotifications(); await logs.reload(); }, 'Message queued again');
  const s = status.data;
  return (
    <Page title="Notifications" actions={<button className="btn btn-small" disabled={busy} onClick={sendNow}>Send queued messages now</button>}>
      <section className="card form-card">
        <h2>Service status</h2>
        {status.loading && !s ? <p className="muted">Checking...</p> : status.error ? <p className="field-error">Could not check the notification service: {status.error.message} (Is the "notifications" Edge Function deployed? See docs/NOTIFICATIONS.md.)</p> : (
          <div className="svc-grid">
            <div><strong>Email (Resend)</strong> <Badge ok={s.email.configured}>{s.email.configured ? 'Connected' : 'Not set up'}</Badge>{!s.email.configured && <p className="muted small">Missing secret: {s.email.missing.join(', ')}. Orders still work; emails are skipped until this is added.</p>}</div>
            <div><strong>WhatsApp Business API</strong> <Badge ok={s.whatsapp.configured}>{s.whatsapp.configured ? 'Connected' : 'Not set up'}</Badge>{!s.whatsapp.configured && <p className="muted small">Missing secrets: {s.whatsapp.missing.join(', ')}. Until then, use the manual WhatsApp buttons on each order.</p>}</div>
          </div>
        )}
        <p className="muted small">API keys are stored only as secrets in Supabase. They are never shown here and never saved in the database.</p>
      </section>

      <Load state={cfg}>{() => f && (
        <form className="card form-card" noValidate onSubmit={save}>
          <h2>Who gets notified</h2>
          <div className="form-grid">
            <Field label="Owner email address"><input type="email" value={f.owner_email || ''} onChange={(e) => set('owner_email', e.target.value)} /></Field>
            <Field label="Owner WhatsApp number" hint="10-digit Indian mobile number"><input type="tel" value={f.owner_whatsapp || ''} onChange={(e) => set('owner_whatsapp', e.target.value)} /></Field>
            <Field label="Email 'from' name and address (optional)" hint="Must use a domain verified in Resend. Example: Mandal Masala <orders@yourdomain.com>" className="span2"><input value={f.email_from || ''} onChange={(e) => set('email_from', e.target.value)} /></Field>
          </div>
          <div className="switches">
            <Switch checked={f.owner_email_enabled} onChange={(v) => set('owner_email_enabled', v)} label="Email me about new orders" />
            <Switch checked={f.customer_email_enabled} onChange={(v) => set('customer_email_enabled', v)} label="Email customers (confirmation and status updates)" />
            <Switch checked={f.owner_whatsapp_enabled} onChange={(v) => set('owner_whatsapp_enabled', v)} label="WhatsApp me about new orders" />
            <Switch checked={f.customer_whatsapp_enabled} onChange={(v) => set('customer_whatsapp_enabled', v)} label="WhatsApp customers (confirmation and status updates)" />
          </div>
          <details className="details"><summary>WhatsApp template names (advanced)</summary>
            <p className="muted small">WhatsApp requires pre-approved message templates created in Meta Business Manager. Enter their exact names here. See docs/NOTIFICATIONS.md.</p>
            <div className="form-grid">
              <Field label="Owner: new order"><input value={f.wa_template_owner_new} onChange={(e) => set('wa_template_owner_new', e.target.value)} /></Field>
              <Field label="Customer: order confirmation"><input value={f.wa_template_customer_confirm} onChange={(e) => set('wa_template_customer_confirm', e.target.value)} /></Field>
              <Field label="Customer: status update"><input value={f.wa_template_customer_status} onChange={(e) => set('wa_template_customer_status', e.target.value)} /></Field>
              <Field label="Template language code"><input value={f.wa_template_language} onChange={(e) => set('wa_template_language', e.target.value)} /></Field>
            </div>
          </details>
          <div className="form-actions"><button className="btn btn-primary" disabled={busy}>Save settings</button></div>
          <h3>Send a test</h3>
          <div className="test-row">
            <div><Field label="Test email to"><input type="email" placeholder={f.owner_email || 'you@example.com'} value={testTo.email} onChange={(e) => setTestTo({ ...testTo, email: e.target.value })} /></Field><button type="button" className="btn btn-small" disabled={busy} onClick={() => test('email')}>Send test email</button>{testMsg.email && <p className="small">{testMsg.email}</p>}</div>
            <div><Field label="Test WhatsApp to"><input type="tel" placeholder={f.owner_whatsapp || '10-digit number'} value={testTo.whatsapp} onChange={(e) => setTestTo({ ...testTo, whatsapp: e.target.value })} /></Field><button type="button" className="btn btn-small" disabled={busy} onClick={() => test('whatsapp')}>Send test WhatsApp</button>{testMsg.whatsapp && <p className="small">{testMsg.whatsapp}</p>}</div>
          </div>
        </form>
      )}</Load>

      <section className="card form-card">
        <div className="sec-head"><h2>Message log</h2><button className="btn btn-small" onClick={logs.reload}>Refresh</button></div>
        <Load state={logs}>{(list) => list.length === 0 ? <p className="muted">No messages yet. They appear here after the first order.</p> : (
          <div className="table-scroll"><table className="table"><thead><tr><th>When</th><th>Order</th><th>To</th><th>Channel</th><th>Event</th><th>Status</th><th /></tr></thead><tbody>
            {list.map((n) => <tr key={n.id}><td>{fmtDate(n.created_at)}</td><td>{n.order_code}</td><td>{n.recipient_type}</td><td>{n.channel}</td><td>{n.event.replace(/_/g, ' ')}</td>
              <td><span className={'badge badge-n-' + n.status}>{n.status}</span>{n.last_error && <small className="field-error block">{n.last_error}</small>}{n.status === 'failed' && <small className="muted block">tried {n.attempts} time(s)</small>}</td>
              <td>{(n.status === 'failed' || n.status === 'skipped') && <button className="btn btn-small" disabled={busy} onClick={() => retry(n)}>Retry</button>}</td></tr>)}
          </tbody></table></div>
        )}</Load>
        <p className="muted small">Failed messages are retried automatically a few times. A failed message never affects the order itself.</p>
      </section>
    </Page>
  );
}

// ------------------------------------------------------------------ shop settings
const LONG = new Set(['about_text', 'delivery_policy', 'return_policy', 'privacy_policy', 'terms_text', 'hero_subtitle']);
const FIELDS = [
  ['shop_name', 'Shop name'], ['tagline', 'Tagline'], ['address', 'Shop address'], ['contact_phone', 'Phone number shown to customers'], ['contact_whatsapp', 'WhatsApp number for customers (optional)'],
  ['contact_email', 'Contact email (optional)'], ['opening_hours', 'Opening hours (optional)'], ['announcement', 'Announcement bar text (optional)'],
  ['hero_title', 'Home page headline'], ['hero_subtitle', 'Home page sub-headline'], ['about_text', 'About the shop'],
  ['delivery_policy', 'Delivery & payment policy'], ['return_policy', 'Returns policy'], ['privacy_policy', 'Privacy policy'], ['terms_text', 'Terms'],
];
export function Settings() {
  const cfg = useAsync(() => adminRpc('admin_get_settings'));
  const [f, setF] = useState(null);
  const [busy, run] = useAction();
  if (cfg.data && !f) setF({ ...cfg.data.store });
  return (
    <Page title="Shop settings">
      <Load state={cfg}>{() => f && (
        <form className="card form-card" onSubmit={async (e) => { e.preventDefault(); const r = await run(() => adminRpc('admin_save_store_settings', { p: { ...f, low_stock_threshold: f.low_stock_threshold === '' ? 0 : Number(f.low_stock_threshold) } }), 'Settings saved'); if (r.ok) setF({ ...r.data }); }}>
          <div className="form-grid">
            {FIELDS.map(([k, label]) => <Field key={k} label={label} className={LONG.has(k) || k === 'address' ? 'span2' : ''}>{LONG.has(k) ? <textarea rows={4} value={f[k] || ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} /> : <input value={f[k] || ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} />}</Field>)}
            <Field label="Low-stock alert level" hint="Warn when a pack size has this many or fewer left"><input inputMode="numeric" value={f.low_stock_threshold} onChange={(e) => setF({ ...f, low_stock_threshold: e.target.value.replace(/\D/g, '') })} /></Field>
          </div>
          <div className="form-actions"><button className="btn btn-primary btn-lg" disabled={busy}>{busy ? 'Saving...' : 'Save settings'}</button></div>
        </form>
      )}</Load>
    </Page>
  );
}
