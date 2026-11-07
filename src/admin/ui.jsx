import { useState } from 'react';
import { useShop } from '../lib/shop.jsx';
import { ErrorBox, Spinner } from '../components/ui.jsx';

/** Runs an action with a busy flag and a toast for success / error. */
export function useAction() {
  const { toast } = useShop();
  const [busy, setBusy] = useState(false);
  const run = async (fn, okMsg) => {
    setBusy(true);
    try { const r = await fn(); if (okMsg) toast(okMsg); return { ok: true, data: r }; }
    catch (e) { toast(e.message || 'Something went wrong', 'err'); return { ok: false, error: e }; }
    finally { setBusy(false); }
  };
  return [busy, run];
}

export const Page = ({ title, actions, children }) => (
  <div className="page"><div className="page-head"><h1>{title}</h1><div className="page-actions">{actions}</div></div>{children}</div>
);

export function Load({ state, children }) {
  if (state.error && !state.data) return <ErrorBox error={state.error} onRetry={state.reload} />;
  if (state.loading && !state.data) return <Spinner />;
  return <>{state.error && <ErrorBox error={state.error} onRetry={state.reload} />}{children(state.data)}</>;
}
