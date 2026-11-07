import { createContext, useContext, useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { rpc } from './api.js';
import { useLocalState } from './util.js';

const Ctx = createContext(null);
export const useShop = () => useContext(Ctx);
const CART_KEY = 'mmb.cart.v1';

export function ShopProvider({ children }) {
  const [catalog, setCatalog] = useState(null);
  const [store, setStore] = useState(null);
  const [error, setError] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [items, setItems] = useLocalState(CART_KEY, []);   // [{ id: variantId, qty }]  (only IDs and counts, never prices)
  const [pin, setPin] = useLocalState('mmb.pin', '');
  const tid = useRef(0);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [c, s] = await Promise.all([rpc('get_catalog'), rpc('get_store_info')]);
      setCatalog(c); setStore(s);
    } catch (e) { setError(e); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const toast = useCallback((message, kind = 'ok') => {
    const id = ++tid.current;
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'err' ? 6000 : 3200);
  }, []);

  const index = useMemo(() => {
    const byVariant = new Map(); const byCat = new Map((catalog?.categories || []).map((c) => [c.id, c]));
    for (const p of catalog?.products || []) for (const v of p.variants) byVariant.set(v.id, { product: p, variant: v, category: byCat.get(p.category_id) });
    return { byVariant, byCat };
  }, [catalog]);

  const lines = useMemo(() => items.map((it) => {
    const hit = index.byVariant.get(it.id);
    const ok = !!hit && hit.variant.in_stock;
    return { id: it.id, qty: it.qty, product: hit?.product, variant: hit?.variant, ok, total: ok ? hit.variant.price * it.qty : 0 };
  }), [items, index]);
  const subtotal = lines.reduce((s, l) => s + l.total, 0);
  const count = items.reduce((s, i) => s + i.qty, 0);

  const add = useCallback((variantId, qty = 1) => setItems((cur) => {
    const f = cur.find((i) => i.id === variantId);
    if (f) return cur.map((i) => (i.id === variantId ? { ...i, qty: Math.min(100, i.qty + qty) } : i));
    return [...cur, { id: variantId, qty: Math.min(100, qty) }];
  }), [setItems]);
  const setQty = useCallback((id, qty) => setItems((cur) => (qty < 1 ? cur.filter((i) => i.id !== id) : cur.map((i) => (i.id === id ? { ...i, qty: Math.min(100, qty) } : i)))), [setItems]);
  const remove = useCallback((id) => setItems((cur) => cur.filter((i) => i.id !== id)), [setItems]);
  const clear = useCallback(() => setItems([]), [setItems]);

  const value = { catalog, store, error, reload: load, toast, toasts, lines, subtotal, count, add, setQty, remove, clear, pin, setPin, index };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
