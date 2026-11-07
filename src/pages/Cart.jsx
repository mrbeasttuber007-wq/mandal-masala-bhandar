import { Link } from '../lib/router.jsx';
import { useShop } from '../lib/shop.jsx';
import { money } from '../lib/util.js';
import { Spinner, Empty, ErrorBox } from '../components/ui.jsx';
import { ProductImage } from '../components/Product.jsx';
import { useDelivery, DeliveryNote } from '../components/Delivery.jsx';
import { IconCart, IconTrash } from '../components/art.jsx';

export default function Cart() {
  const { catalog, error, reload, lines, subtotal, setQty, remove, clear, index, pin, setPin, add } = useShop();
  const del = useDelivery(pin, subtotal);
  if (error) return <div className="wrap section"><ErrorBox error={error} onRetry={reload} /></div>;
  if (!catalog) return <div className="wrap section"><Spinner label="Loading your cart..." /></div>;
  if (lines.length === 0) return <div className="wrap section"><Empty icon={<IconCart size={40} />} title="Your cart is empty">Browse our spices and dry fruits and add what you like.<div><Link to="/shop" className="btn btn-primary">Start shopping</Link></div></Empty></div>;

  const bad = lines.filter((l) => !l.ok);
  const good = lines.filter((l) => l.ok);
  const charge = del.status === 'ok' ? del.info.delivery_charge : null;
  const minOk = del.status !== 'ok' || del.info.meets_minimum;
  const blocked = good.length === 0 || bad.length > 0 || del.status === 'no' || !minOk;
  return (
    <div className="wrap section">
      <h1 className="h1">Your cart</h1>
      {bad.length > 0 && <div className="alert alert-warn" role="alert"><strong>Some items are no longer available.</strong> Please remove them to continue.</div>}
      <div className="cart-layout">
        <div className="card cart-lines">
          {lines.map((l) => {
            if (!l.product) return (
              <div key={l.id} className="cart-line is-bad"><div className="cart-info"><strong>Item no longer sold</strong><span className="muted">This product has been removed from the shop.</span></div><button className="icon-btn danger" onClick={() => remove(l.id)} aria-label="Remove item"><IconTrash size={18} /></button></div>
            );
            const sibs = l.product.variants;
            return (
              <div key={l.id} className={'cart-line' + (l.ok ? '' : ' is-bad')}>
                <Link to={'/product/' + l.product.slug} className="cart-thumb"><ProductImage product={l.product} category={index.byCat.get(l.product.category_id)} /></Link>
                <div className="cart-info">
                  <Link to={'/product/' + l.product.slug} className="cart-name">{l.product.name}</Link>
                  <label className="cart-size">Pack size
                    <select value={l.id} onChange={(e) => { const nv = e.target.value; if (nv !== l.id) { add(nv, l.qty); remove(l.id); } }} aria-label={`Pack size for ${l.product.name}`}>
                      {sibs.map((v) => <option key={v.id} value={v.id} disabled={!v.in_stock}>{v.label} - {money(v.price)}{v.in_stock ? '' : ' (out of stock)'}</option>)}
                    </select>
                  </label>
                  {!l.ok && <span className="field-error">{l.variant ? 'Out of stock right now' : 'Not available'}</span>}
                </div>
                <div className="cart-right">
                  <div className="qty">
                    <button onClick={() => setQty(l.id, l.qty - 1)} aria-label="Fewer">&minus;</button><span>{l.qty}</span><button onClick={() => setQty(l.id, l.qty + 1)} aria-label="More">+</button>
                  </div>
                  <strong className="cart-total">{money(l.total)}</strong>
                  <button className="link-danger" onClick={() => remove(l.id)}><IconTrash size={16} /> Remove</button>
                </div>
              </div>
            );
          })}
          <div className="cart-foot"><button className="link-danger" onClick={() => { if (confirm('Remove everything from your cart?')) clear(); }}>Empty cart</button><Link to="/shop">&larr; Continue shopping</Link></div>
        </div>

        <aside className="card summary">
          <h2>Order summary</h2>
          <div className="srow"><span>Subtotal</span><strong>{money(subtotal)}</strong></div>
          <label className="field"><span className="field-label">Delivery PIN code</span>
            <input inputMode="numeric" maxLength={6} placeholder="e.g. your 6-digit PIN" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
          </label>
          <DeliveryNote state={del} subtotal={subtotal} />
          <div className="srow"><span>Delivery</span><strong>{charge == null ? 'Enter PIN' : charge === 0 ? 'Free' : money(charge)}</strong></div>
          <div className="srow total"><span>{charge == null ? 'Total (before delivery)' : 'Total to pay'}</span><strong>{money(subtotal + (charge || 0))}</strong></div>
          <p className="muted small">Pay in cash when your order arrives.</p>
          {blocked ? <button className="btn btn-primary btn-block btn-lg" disabled>Proceed to checkout</button> : <Link to="/checkout" className="btn btn-primary btn-block btn-lg">Proceed to checkout</Link>}
        </aside>
      </div>
    </div>
  );
}
