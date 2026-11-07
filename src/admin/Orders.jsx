import { useEffect, useState } from 'react';
import { Link, useQuery } from '../lib/router.jsx';
import { adminRpc, drainNotifications } from '../lib/api.js';
import { useAsync, useDebounced, money, fmtDate, STATUSES, statusLabel, toCsv, download, waLink } from '../lib/util.js';
import { StatusBadge, Empty } from '../components/ui.jsx';
import { IconWhatsApp } from '../components/art.jsx';
import { useShop } from '../lib/shop.jsx';
import { Page, Load, useAction } from './ui.jsx';

const PAGE = 25;

export function OrdersList() {
  const q = useQuery();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(q.get('status') || '');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [offset, setOffset] = useState(0);
  const s = useDebounced(search, 350);
  const filters = { search: s, status, from, to };
  useEffect(() => setOffset(0), [s, status, from, to]);
  const st = useAsync(() => adminRpc('admin_list_orders', { p: { ...filters, limit: PAGE, offset } }), [s, status, from, to, offset]);
  const [busy, run] = useAction();

  const exportCsv = () => run(async () => {
    const r = await adminRpc('admin_list_orders', { p: { ...filters, limit: 1000, offset: 0 } });
    const rows = [['Order ID', 'Date', 'Status', 'Customer', 'Mobile', 'Address', 'Items', 'Subtotal', 'Delivery', 'Total', 'Payment']];
    for (const o of r.orders) rows.push([o.order_code, fmtDate(o.created_at), statusLabel(o.status), o.customer_name, o.customer_phone, o.address, o.items_summary, o.subtotal, o.delivery_charge, o.total, 'Cash on delivery']);
    download(`orders-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows));
    return r.orders.length;
  }, 'Report downloaded');

  return (
    <Page title="Orders" actions={<button className="btn btn-small" disabled={busy} onClick={exportCsv}>{busy ? 'Preparing...' : 'Export CSV'}</button>}>
      <div className="card form-card filters">
        <label className="field"><span className="field-label">Search</span><input placeholder="Order ID, name or mobile" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
        <label className="field"><span className="field-label">Status</span><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label className="field"><span className="field-label">From date</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="field"><span className="field-label">To date</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        {(search || status || from || to) && <button className="btn btn-small" onClick={() => { setSearch(''); setStatus(''); setFrom(''); setTo(''); }}>Clear</button>}
      </div>
      <Load state={st}>{(d) => d.orders.length === 0 ? <Empty title="No orders found">{search || status || from || to ? 'Try changing the filters.' : 'New orders will appear here.'}</Empty> : (
        <>
          <div className="card table-card"><table className="table responsive">
            <thead><tr><th>Order</th><th>Date</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th></tr></thead>
            <tbody>{d.orders.map((o) => (
              <tr key={o.id}>
                <td data-label="Order"><Link to={'/admin/orders/' + o.id}><strong>{o.order_code}</strong></Link></td>
                <td data-label="Date">{fmtDate(o.created_at)}</td>
                <td data-label="Customer">{o.customer_name}<br /><small>{o.customer_phone}</small></td>
                <td data-label="Items" className="items-cell">{o.items_summary}</td>
                <td data-label="Total">{money(o.total)}</td>
                <td data-label="Status"><StatusBadge status={o.status} /></td>
              </tr>))}</tbody>
          </table></div>
          <div className="pager"><button className="btn btn-small" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>&larr; Newer</button>
            <span>{offset + 1}&ndash;{Math.min(offset + PAGE, d.total)} of {d.total}</span>
            <button className="btn btn-small" disabled={offset + PAGE >= d.total} onClick={() => setOffset(offset + PAGE)}>Older &rarr;</button></div>
        </>
      )}</Load>
    </Page>
  );
}

const NEXT = { pending: ['confirmed'], confirmed: ['processing', 'out_for_delivery'], processing: ['out_for_delivery'], out_for_delivery: ['delivered'] };

function summaryText(o, store) {
  return `*New order ${o.order_code}*\nCustomer: ${o.customer_name}\nMobile: ${o.customer_phone}\n` + o.items.map((i) => `- ${i.product_name} (${i.variant_label}) x ${i.quantity} = Rs. ${i.line_total}`).join('\n') + `\nDelivery: Rs. ${o.delivery_charge}\n*Total (COD): Rs. ${o.total}*\nAddress: ${o.address_line}, ${o.locality}, ${o.city}, ${o.state} ${o.pin_code}` + (o.notes ? `\nNotes: ${o.notes}` : '');
}
const customerText = (o, shop) => ({
  pending: `Hello ${o.customer_name}, we received your order ${o.order_code} (Rs. ${o.total}, cash on delivery). - ${shop}`,
  confirmed: `Hello ${o.customer_name}, your order ${o.order_code} is confirmed. - ${shop}`,
  processing: `Hello ${o.customer_name}, we are preparing your order ${o.order_code}. - ${shop}`,
  out_for_delivery: `Hello ${o.customer_name}, your order ${o.order_code} is out for delivery. Please keep Rs. ${o.total} ready in cash. - ${shop}`,
  delivered: `Hello ${o.customer_name}, your order ${o.order_code} has been delivered. Thank you for shopping with us! - ${shop}`,
  cancelled: `Hello ${o.customer_name}, your order ${o.order_code} has been cancelled. Please contact us if you have questions. - ${shop}`,
}[o.status]);

export function OrderDetail({ id }) {
  const { store, toast } = useShop();
  const st = useAsync(() => adminRpc('admin_get_order', { p_id: id }), [id]);
  const [busy, run] = useAction();
  const [note, setNote] = useState('');

  const change = async (status) => {
    if (status === 'cancelled' && !confirm('Cancel this order? The stock will be put back.')) return;
    const r = await run(() => adminRpc('admin_update_order_status', { p_id: id, p_status: status, p_note: note || null }), `Order marked ${statusLabel(status)}`);
    if (r.ok) { st.setData(r.data); setNote(''); drainNotifications().then(() => st.reload()); }
  };
  return (
    <Page title="Order details" actions={<Link to="/admin/orders" className="btn btn-small">&larr; All orders</Link>}>
      <Load state={st}>{(o) => (
        <div className="two-col">
          <section className="card form-card">
            <div className="order-id"><strong>{o.order_code}</strong><StatusBadge status={o.status} /></div>
            <p className="muted small">Placed {fmtDate(o.created_at)} &middot; Payment: Cash on delivery</p>
            <h3>Items</h3>
            <ul className="sum-items">{o.items.map((i, k) => <li key={k}><span>{i.product_name} <em>({i.variant_label})</em><br /><small>{money(i.unit_price)} &times; {i.quantity}</small></span><strong>{money(i.line_total)}</strong></li>)}</ul>
            <div className="srow"><span>Subtotal</span><strong>{money(o.subtotal)}</strong></div>
            <div className="srow"><span>Delivery ({o.delivery_zone_name})</span><strong>{money(o.delivery_charge)}</strong></div>
            <div className="srow total"><span>Collect in cash</span><strong>{money(o.total)}</strong></div>
            <h3>Customer</h3>
            <div className="kv"><span>Name</span><p>{o.customer_name}</p><span>Mobile</span><p><a href={'tel:' + o.customer_phone}>{o.customer_phone}</a></p>
              {o.customer_email && <><span>Email</span><p>{o.customer_email}</p></>}
              <span>Address</span><p>{o.address_line}, {o.locality}, {o.city}, {o.state} {o.pin_code}</p>
              {o.notes && <><span>Notes</span><p>{o.notes}</p></>}</div>
          </section>
          <section className="card form-card">
            <h3>Update status</h3>
            {NEXT[o.status] || o.status === 'pending' ? (
              <>
                <label className="field"><span className="field-label">Note (optional, saved in history)</span><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} /></label>
                <div className="row-actions">
                  {(NEXT[o.status] || []).map((s) => <button key={s} className="btn btn-primary" disabled={busy} onClick={() => change(s)}>Mark {statusLabel(s)}</button>)}
                  <button className="btn btn-danger" disabled={busy} onClick={() => change('cancelled')}>Cancel order</button>
                </div>
              </>
            ) : <p className="muted">This order is {statusLabel(o.status).toLowerCase()} and cannot be changed.</p>}
            <h3>WhatsApp (manual)</h3>
            <p className="muted small">Opens WhatsApp with the message already written. You press Send yourself.</p>
            <div className="row-actions">
              <a className="btn btn-ghost" target="_blank" rel="noopener noreferrer" href={waLink(o.customer_phone, customerText(o, store?.shop_name || 'Mandal Masala Bhandar'))}><IconWhatsApp size={18} /> Message customer</a>
              <button className="btn btn-ghost" onClick={() => navigator.clipboard?.writeText(summaryText(o, store)).then(() => toast('Order summary copied'), () => toast('Could not copy', 'err'))}>Copy order summary</button>
            </div>
            <h3>Status history</h3>
            <ul className="history">{o.history.map((h, k) => <li key={k}><StatusBadge status={h.to_status} /> <span>{fmtDate(h.at)}</span>{h.note && <em> &ndash; {h.note}</em>}</li>)}</ul>
            <h3>Notifications</h3>
            {o.notifications.length === 0 ? <p className="muted small">None.</p> : (
              <ul className="history">{o.notifications.map((n) => <li key={n.id}><span className={'badge badge-n-' + n.status}>{n.status}</span> {n.recipient_type} {n.channel} ({n.event.replace(/_/g, ' ')}){n.last_error && <small className="field-error"> {n.last_error}</small>}</li>)}</ul>
            )}
          </section>
        </div>
      )}</Load>
    </Page>
  );
}
