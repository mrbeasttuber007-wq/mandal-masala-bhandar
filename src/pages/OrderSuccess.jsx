import { Link, useQuery } from '../lib/router.jsx';
import { useShop } from '../lib/shop.jsx';
import { money, fmtDate, waLink } from '../lib/util.js';
import { IconCheck, IconWhatsApp } from '../components/art.jsx';
import { Empty } from '../components/ui.jsx';

export default function OrderSuccess() {
  const code = useQuery().get('code') || '';
  const { store, toast } = useShop();
  let saved = null;
  try { const s = JSON.parse(sessionStorage.getItem('mmb.lastOrder') || 'null'); if (s && s.order && s.order.order_code === code) saved = s; } catch { /* ignore */ }
  if (!saved) return (
    <div className="wrap section"><Empty title={code ? 'Order ' + code : 'No recent order'}>
      {code ? 'Your order is saved. To see its details, track it with your order ID and mobile number.' : 'Place an order to see it here.'}
      <div><Link className="btn btn-primary" to={'/track' + (code ? '?code=' + encodeURIComponent(code) : '')}>Track this order</Link></div>
    </Empty></div>
  );
  const { order: o, phone, name, address } = saved;
  const shopWa = store && (store.contact_whatsapp || store.contact_phone);
  const text = `Hello, I placed an order on your website.\nOrder ID: ${o.order_code}\nName: ${name}\nMobile: ${phone}\n` + o.items.map((i) => `- ${i.product_name} (${i.variant_label}) x ${i.quantity}`).join('\n') + `\nTotal (COD): Rs. ${o.total}\nAddress: ${address}`;
  return (
    <div className="wrap section narrow">
      <div className="success-head"><span className="success-tick"><IconCheck size={30} /></span><h1 className="h1">Thank you, {name.split(' ')[0]}!</h1><p>Your order has been placed. Please keep cash ready for delivery.</p></div>
      <div className="card order-card">
        <div className="order-id"><span>Your order ID</span><strong>{o.order_code}</strong>
          <button className="btn btn-small" onClick={() => { navigator.clipboard?.writeText(o.order_code).then(() => toast('Order ID copied'), () => toast('Please copy the ID by hand', 'err')); }}>Copy</button></div>
        <p className="muted small">Save this ID. To track your order you will need it together with the mobile number you entered ({phone}).</p>
        <ul className="sum-items">
          {o.items.map((i, k) => <li key={k}><span>{i.product_name} <em>({i.variant_label})</em><br /><small>{money(i.unit_price)} &times; {i.quantity}</small></span><strong>{money(i.line_total)}</strong></li>)}
        </ul>
        <div className="srow"><span>Subtotal</span><strong>{money(o.subtotal)}</strong></div>
        <div className="srow"><span>Delivery ({o.delivery_zone_name})</span><strong>{o.delivery_charge === 0 ? 'Free' : money(o.delivery_charge)}</strong></div>
        <div className="srow total"><span>Pay on delivery</span><strong>{money(o.total)}</strong></div>
        <div className="kv"><span>Delivering to</span><p>{name}, {address}</p><span>Placed on</span><p>{fmtDate(o.created_at)}</p><span>Status</span><p>Pending. The shop will confirm your order soon.</p></div>
        <div className="row-actions">
          <Link className="btn btn-primary" to={'/track?code=' + encodeURIComponent(o.order_code)}>Track order</Link>
          {shopWa && <a className="btn btn-ghost" target="_blank" rel="noopener noreferrer" href={waLink(shopWa, text)}><IconWhatsApp size={18} /> Send order on WhatsApp</a>}
          <Link className="btn btn-ghost" to="/shop">Continue shopping</Link>
        </div>
      </div>
    </div>
  );
}
