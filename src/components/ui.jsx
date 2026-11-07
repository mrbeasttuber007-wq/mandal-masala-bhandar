import { useEffect } from 'react';
import { useShop } from '../lib/shop.jsx';

export const Spinner = ({ label = 'Loading...' }) => (
  <div className="spinner-wrap" role="status"><span className="spinner" /><span>{label}</span></div>
);

export function ErrorBox({ error, onRetry, title = 'Something went wrong' }) {
  if (!error) return null;
  return (
    <div className="alert alert-err" role="alert">
      <strong>{title}</strong>
      <p>{error.message || String(error)}</p>
      {onRetry && <button className="btn btn-small" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export const Empty = ({ icon, title, children }) => (
  <div className="empty">{icon && <div className="empty-icon">{icon}</div>}<h3>{title}</h3><div>{children}</div></div>
);

export function Toasts() {
  const { toasts } = useShop();
  return <div className="toasts" aria-live="polite">{toasts.map((t) => <div key={t.id} className={'toast toast-' + t.kind}>{t.message}</div>)}</div>;
}

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', k);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', k); document.body.style.overflow = ''; };
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'modal' + (wide ? ' modal-wide' : '')} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head"><h3>{title}</h3><button className="icon-btn" onClick={onClose} aria-label="Close">&times;</button></div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, hint, error, children, className = '' }) {
  return (
    <label className={'field ' + className + (error ? ' has-error' : '')}>
      <span className="field-label">{label}</span>
      {children}
      {hint && !error && <span className="field-hint">{hint}</span>}
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}

export const Switch = ({ checked, onChange, label, disabled }) => (
  <label className={'switch' + (disabled ? ' is-disabled' : '')}>
    <input type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    <span className="switch-track"><span className="switch-dot" /></span>
    {label && <span>{label}</span>}
  </label>
);

export function StatusBadge({ status }) {
  const text = { pending: 'Pending', confirmed: 'Confirmed', processing: 'Processing', out_for_delivery: 'Out for Delivery', delivered: 'Delivered', cancelled: 'Cancelled' }[status] || status;
  return <span className={'badge badge-' + status}>{text}</span>;
}
