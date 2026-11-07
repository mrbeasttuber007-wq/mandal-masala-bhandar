import { useEffect, useRef, useState } from 'react';
import { Link, useRouter } from '../lib/router.jsx';
import { useShop } from '../lib/shop.jsx';
import { rpc, drainNotifications } from '../lib/api.js';
import { money, cleanPhone, uuid } from '../lib/util.js';
import { Spinner, Empty, Field } from '../components/ui.jsx';
import { useDelivery, DeliveryNote } from '../components/Delivery.jsx';

const KEY = 'mmb.checkoutKey';
const blank = { name: '', phone: '', email: '', address: '', locality: '', city: '', state: 'West Bengal', pin: '', notes: '' };

function validate(f) {
  const e = {};
  if (f.name.trim().length < 2) e.name = 'Please enter your full name.';
  if (!cleanPhone(f.phone)) e.phone = 'Enter a valid 10-digit Indian mobile number.';
  if (f.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) e.email = 'This email address does not look right.';
  if (f.address.trim().length < 8) e.address = 'Please enter your full delivery address (house, street, landmark).';
  if (f.locality.trim().length < 2) e.locality = 'Please enter your locality or area.';
  if (f.city.trim().length < 2) e.city = 'Please enter your city or town.';
  if (f.state.trim().length < 2) e.state = 'Please enter your state.';
  if (!/^[1-9]\d{5}$/.test(f.pin.trim())) e.pin = 'Enter a valid 6-digit PIN code.';
  return e;
}

export default function Checkout() {
  const { catalog, lines, subtotal, clear, pin: savedPin, setPin, reload, toast } = useShop();
  const { navigate } = useRouter();
  const [f, setF] = useState(() => { let saved = {}; try { saved = JSON.parse(localStorage.getItem('mmb.customer') || '{}'); } catch { /* ignore */ } return { ...blank, ...saved, pin: savedPin || saved.pin || '' }; });
  const [errs, setErrs] = useState({});
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState(null);
  const lock = useRef(false);
  const keyRef = useRef(null);
  if (!keyRef.current) { try { keyRef.current = sessionStorage.getItem(KEY) || uuid(); sessionStorage.setItem(KEY, keyRef.current); } catch { keyRef.current = uuid(); } }

  const del = useDelivery(f.pin, subtotal);
  useEffect(() => { try { const { notes, ...rest } = f; localStorage.setItem('mmb.customer', JSON.stringify(rest)); } catch { /* ignore */ } }, [f]);
  const set = (k) => (e) => { setF((x) => ({ ...x, [k]: k === 'pin' ? e.target.value.replace(/\D/g, '') : e.target.value })); setErrs((x) => ({ ...x, [k]: undefined })); };

  if (!catalog) return <div className="wrap section"><Spinner label="Loading..." /></div>;
  const good = lines.filter((l) => l.ok);
  if (lines.length === 0) return <div className="wrap section"><Empty title="Your cart is empty">Add some products before checking out.<div><Link to="/shop" className="btn btn-primary">Go to shop</Link></div></Empty></div>;
  if (good.length !== lines.length) return <div className="wrap section"><Empty title="Please review your cart">Some items are no longer available.<div><Link to="/cart" className="btn btn-primary">Back to cart</Link></div></Empty></div>;

  const charge = del.status === 'ok' ? del.info.delivery_charge : null;
  const total = subtotal + (charge || 0);

  async function submit(e) {
    e.preventDefault();
    if (lock.current) return;                       // blocks double taps
    const v = validate(f); setErrs(v); setFail(null);
    if (Object.keys(v).length) { toast('Please fix the highlighted fields.', 'err'); document.querySelector('.has-error input, .has-error textarea')?.focus(); return; }
    if (del.status !== 'ok') { setErrs({ pin: del.status === 'no' ? del.info.message : 'Please wait while we check your PIN code.' }); return; }
    if (!del.info.meets_minimum) { setFail({ message: `The minimum order for your area is ${money(del.info.min_order_value)}. Please add more items.` }); return; }
    lock.current = true; setBusy(true);
    try {
      const res = await rpc('place_order', { p: {
        idempotency_key: keyRef.current, expected_total: total,
        customer: { name: f.name.trim(), phone: f.phone.trim(), email: f.email.trim(), address: f.address.trim(), locality: f.locality.trim(), city: f.city.trim(), state: f.state.trim(), pin: f.pin.trim(), notes: f.notes.trim() },
        items: good.map((l) => ({ variant_id: l.id, quantity: l.qty })),   // only IDs and counts; the server looks up prices
      } });
      try { sessionStorage.setItem('mmb.lastOrder', JSON.stringify({ order: res, phone: cleanPhone(f.phone), name: f.name.trim(), address: `${f.address.trim()}, ${f.locality.trim()}, ${f.city.trim()}, ${f.state.trim()} ${f.pin.trim()}` })); sessionStorage.removeItem(KEY); } catch { /* ignore */ }
      setPin(f.pin.trim()); clear(); reload();
      drainNotifications();                          // fire and forget: the order is already saved
      navigate('/order-success?code=' + encodeURIComponent(res.order_code), { replace: true });
    } catch (err) {
      setFail(err);
      if (err.hint && ['name', 'phone', 'email', 'address', 'locality', 'city', 'state', 'pin', 'notes'].includes(err.hint)) setErrs({ [err.hint]: err.message });
      if (['price_changed', 'out_of_stock', 'unavailable', 'cart'].includes(err.hint)) reload();   // refresh prices/stock
      lock.current = false; setBusy(false);
    }
  }

  return (
    <div className="wrap section">
      <h1 className="h1">Checkout</h1>
      <form className="cart-layout" onSubmit={submit} noValidate>
        <div className="card form-card">
          <h2>Delivery details</h2>
          <div className="form-grid">
            <Field label="Full name *" error={errs.name}><input autoComplete="name" value={f.name} onChange={set('name')} maxLength={80} /></Field>
            <Field label="Mobile number *" error={errs.phone} hint="10-digit number. You will need it to track your order."><input type="tel" inputMode="tel" autoComplete="tel" value={f.phone} onChange={set('phone')} maxLength={16} /></Field>
            <Field label="Email (optional)" error={errs.email} hint="For an order confirmation email." className="span2"><input type="email" autoComplete="email" value={f.email} onChange={set('email')} maxLength={120} /></Field>
            <Field label="Full address *" error={errs.address} hint="House / shop number, street, landmark" className="span2"><textarea rows={3} autoComplete="street-address" value={f.address} onChange={set('address')} maxLength={300} /></Field>
            <Field label="Locality / area *" error={errs.locality}><input value={f.locality} onChange={set('locality')} maxLength={100} /></Field>
            <Field label="City / town *" error={errs.city}><input autoComplete="address-level2" value={f.city} onChange={set('city')} maxLength={60} /></Field>
            <Field label="State *" error={errs.state}><input autoComplete="address-level1" value={f.state} onChange={set('state')} maxLength={60} /></Field>
            <Field label="PIN code *" error={errs.pin}><input inputMode="numeric" autoComplete="postal-code" maxLength={6} value={f.pin} onChange={set('pin')} /></Field>
            <div className="span2"><DeliveryNote state={del} subtotal={subtotal} /></div>
            <Field label="Order notes (optional)" hint="Anything the shop should know" className="span2"><textarea rows={2} value={f.notes} onChange={set('notes')} maxLength={500} /></Field>
          </div>
          <div className="pay-box"><strong>Payment: Cash on Delivery</strong><span>Pay the exact amount in cash to the delivery person when your order arrives.</span></div>
        </div>

        <aside className="card summary">
          <h2>Review your order</h2>
          <ul className="sum-items">
            {good.map((l) => <li key={l.id}><span>{l.product.name} <em>({l.variant.label})</em><br /><small>{money(l.variant.price)} &times; {l.qty}</small></span><strong>{money(l.total)}</strong></li>)}
          </ul>
          <div className="srow"><span>Subtotal</span><strong>{money(subtotal)}</strong></div>
          <div className="srow"><span>Delivery</span><strong>{charge == null ? 'Enter PIN' : charge === 0 ? 'Free' : money(charge)}</strong></div>
          <div className="srow total"><span>Total to pay (COD)</span><strong>{money(total)}</strong></div>
          {fail && <div className="alert alert-err" role="alert">{fail.message}</div>}
          <button className="btn btn-primary btn-block btn-lg" disabled={busy}>{busy ? 'Placing your order...' : `Place order - ${money(total)}`}</button>
          <Link to="/cart" className="center-link">&larr; Back to cart</Link>
        </aside>
      </form>
    </div>
  );
}
