import { useEffect, useRef, useState, useCallback } from 'react';

export const money = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: Number(n || 0) % 1 ? 2 : 0, maximumFractionDigits: 2 });
export const fmtDate = (d) => d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }) : '';
export const fmtDay = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '';

export const STATUSES = [
  ['pending', 'Pending'], ['confirmed', 'Confirmed'], ['processing', 'Processing'],
  ['out_for_delivery', 'Out for Delivery'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled'],
];
export const statusLabel = (s) => (STATUSES.find((x) => x[0] === s) || [s, String(s || '')])[1];

/** Same rules as the database (the database has the final say). */
export const cleanPhone = (v) => {
  let d = String(v || '').replace(/[\s\-().]/g, '');
  if (/^\+91\d{10}$/.test(d)) d = d.slice(3); else if (/^91\d{10}$/.test(d)) d = d.slice(2); else if (/^0\d{10}$/.test(d)) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
};

export const waLink = (phone, text) => {
  const p = cleanPhone(phone);
  return `https://wa.me/${p ? '91' + p : ''}?text=${encodeURIComponent(text)}`;
};

/** Loads data with loading + error state. Call reload() after changes. */
export function useAsync(fn, deps = []) {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const seq = useRef(0);
  const run = useCallback(() => {
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    return Promise.resolve().then(fn).then(
      (data) => { if (id === seq.current) setState({ loading: false, error: null, data }); return data; },
      (error) => { if (id === seq.current) setState((s) => ({ loading: false, error, data: s.data })); },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { ...state, reload: run, setData: (data) => setState((s) => ({ ...s, data })) };
}

export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export function useLocalState(key, initial) {
  const [v, setV] = useState(() => { try { const s = localStorage.getItem(key); return s == null ? initial : JSON.parse(s); } catch { return initial; } });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ } }, [key, v]);
  return [v, setV];
}

export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16); }));

export function toCsv(rows) {
  const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return rows.map((r) => r.map(esc).join(',')).join('\r\n');
}
export function download(name, text, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
