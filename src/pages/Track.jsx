import { useEffect, useState } from 'react';
import { useQuery } from '../lib/router.jsx';
import { rpc } from '../lib/api.js';
import { money, fmtDate, statusLabel, cleanPhone } from '../lib/util.js';
import { Field, StatusBadge } from '../components/ui.jsx';

const FLOW = ['pending', 'confirmed', 'processing', 'out_for_delivery', 'delivered'];

export default function Track() {
  const q = useQuery();
  const [code, setCode] = useState(q.get('code') || '');
  const [phone, setPhone] = useState(() => { try { const s = JSON.parse(sessionStorage.getItem('mmb.lastOrder') || 'null'); return s && s.order.order_code === (q.get('code') || '') ? s.phone : ''; } catch { return ''; } });
  const [res, setRes] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  async function go(e) {
    e && e.preventDefault();
    setErr(null); setRes(null);
    if (code.trim().length < 6) return setErr('Please enter your order ID (for example MMB-7K3QX9PD).');
    if (!cleanPhone(phone)) return setErr('Please enter the 10-digit mobile number used for the order.');
    setBusy(true);
    try {
      const r = await rpc('track_order', { p_code: code.trim(), p_phone: phone.trim() });
      if (!r.found) setErr('We could not find an order with that ID and mobile number. Please check both and try again.'); else setRes(r);
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  }
  useEffect(() => { if (q.get('code') && phone) go(); /* eslint-disable-next-line */ }, []);

  const hist = res ? Object.fromEntries(res.history.map((h) => [h.status, h.at])) : {};
  const cancelled = res && res.status === 'cancelled';
  return (
    <div className="wrap section narrow">
      <h1 className="h1">Track your order</h1>
      <form className="card form-card" onSubmit={go} noValidate>
        <div className="form-grid">
          <Field label="Order ID"><input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="MMB-XXXXXXXX" autoCapitalize="characters" maxLength={20} /></Field>
          <Field label="Mobile number used at checkout"><input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10-digit number" maxLength={16} /></Field>
        </div>
        {err && <div className="alert alert-err" role="alert">{err}</div>}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Checking...' : 'Track order'}</button>
        <p className="muted small">For your privacy we need both your order ID and your mobile number.</p>
      </form>

      {res && (
        <div className="card order-card" aria-live="polite">
          <div className="order-id"><span>Order</span><strong>{res.order_code}</strong><StatusBadge status={res.status} /></div>
          <p className="muted small">Placed on {fmtDate(res.created_at)}</p>
          {cancelled
            ? <div className="alert alert-err">This order was cancelled{hist.cancelled ? ' on ' + fmtDate(hist.cancelled) : ''}.</div>
            : (
              <ol className="timeline">
                {FLOW.map((s) => { const done = !!hist[s]; const current = res.status === s; return (
                  <li key={s} className={(done ? 'done ' : '') + (current ? 'current' : '')}><span className="dot" /><div><strong>{statusLabel(s)}</strong>{hist[s] && <small>{fmtDate(hist[s])}</small>}</div></li>
                ); })}
              </ol>
            )}
          <h3>Items</h3>
          <ul className="sum-items">{res.items.map((i, k) => <li key={k}><span>{i.product_name} <em>({i.variant_label})</em><br /><small>{money(i.unit_price)} &times; {i.quantity}</small></span><strong>{money(i.line_total)}</strong></li>)}</ul>
          <div className="srow"><span>Subtotal</span><strong>{money(res.subtotal)}</strong></div>
          <div className="srow"><span>Delivery</span><strong>{res.delivery_charge === 0 ? 'Free' : money(res.delivery_charge)}</strong></div>
          <div className="srow total"><span>Total (cash on delivery)</span><strong>{money(res.total)}</strong></div>
          <div className="kv"><span>Delivering to</span><p>{res.customer_name}, {res.address}</p></div>
          <h3>Status history</h3>
          <ul className="history">{res.history.map((h, k) => <li key={k}><StatusBadge status={h.status} /> <span>{fmtDate(h.at)}</span></li>)}</ul>
        </div>
      )}
    </div>
  );
}
