import { useEffect, useState } from 'react';
import { rpc } from '../lib/api.js';
import { money, useDebounced } from '../lib/util.js';

/** Asks the database whether we deliver to a PIN code and what it costs. Returns { status, info }. */
export function useDelivery(pin, subtotal) {
  const p = useDebounced(String(pin || '').trim(), 350);
  const sub = useDebounced(subtotal, 350);
  const [st, setSt] = useState({ status: 'idle', info: null });
  useEffect(() => {
    if (!/^\d{6}$/.test(p)) { setSt({ status: p ? 'invalid' : 'idle', info: null }); return undefined; }
    let live = true;
    setSt((s) => ({ status: 'loading', info: s.info }));
    rpc('check_delivery', { p_pin: p, p_subtotal: sub }).then(
      (info) => live && setSt({ status: info.deliverable ? 'ok' : 'no', info }),
      (e) => live && setSt({ status: 'error', info: { message: e.message } }),
    );
    return () => { live = false; };
  }, [p, sub]);
  return st;
}

export function DeliveryNote({ state, subtotal }) {
  const { status, info } = state;
  if (status === 'idle') return <p className="field-hint">Enter your PIN code to see delivery charges.</p>;
  if (status === 'invalid') return <p className="field-error">PIN code must be 6 digits.</p>;
  if (status === 'loading') return <p className="field-hint">Checking delivery...</p>;
  if (status === 'error') return <p className="field-error">{info.message}</p>;
  if (status === 'no') return <p className="field-error">{info.message}</p>;
  return (
    <div className="delivery-ok">
      <strong>We deliver to {info.zone_name}.</strong>{' '}
      {info.delivery_charge === 0 ? 'Delivery is free.' : `Delivery charge ${money(info.delivery_charge)}.`}
      {info.free_delivery_threshold != null && info.delivery_charge > 0 && ` Free delivery on orders of ${money(info.free_delivery_threshold)} or more.`}
      {info.min_order_value > 0 && !info.meets_minimum && <div className="field-error">Minimum order for this area is {money(info.min_order_value)}. Add {money(info.min_order_value - subtotal)} more.</div>}
      {info.min_order_value > 0 && info.meets_minimum && <span> Minimum order {money(info.min_order_value)}.</span>}
    </div>
  );
}
