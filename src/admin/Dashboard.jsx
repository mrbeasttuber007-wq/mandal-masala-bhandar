import { useEffect } from 'react';
import { Link } from '../lib/router.jsx';
import { adminRpc } from '../lib/api.js';
import { useAsync, money, fmtDate } from '../lib/util.js';
import { StatusBadge, Empty } from '../components/ui.jsx';
import { Page, Load } from './ui.jsx';

export default function Dashboard() {
  const st = useAsync(() => adminRpc('admin_dashboard'));
  useEffect(() => { const t = setInterval(st.reload, 60000); return () => clearInterval(t); }, [st.reload]);
  return (
    <Page title="Dashboard" actions={<button className="btn btn-small" onClick={st.reload}>Refresh</button>}>
      <Load state={st}>{(d) => (
        <>
          {d.failed_notifications > 0 && <div className="alert alert-warn">{d.failed_notifications} notification(s) failed to send. <Link to="/admin/notifications">Check notifications</Link></div>}
          <div className="stats">
            <Stat label="Total orders" value={d.total_orders} to="/admin/orders" />
            <Stat label="Today's orders" value={d.todays_orders} />
            <Stat label="Pending orders" value={d.pending_orders} tone={d.pending_orders ? 'warn' : ''} to="/admin/orders?status=pending" />
            <Stat label="In progress" value={d.in_progress_orders} />
            <Stat label="Completed (delivered)" value={d.completed_orders} tone="good" />
            <Stat label="Cancelled" value={d.cancelled_orders} />
            <Stat label="Total sales (excl. cancelled)" value={money(d.total_sales)} wide />
            <Stat label="Today's sales" value={money(d.todays_sales)} />
          </div>
          <div className="two-col">
            <section className="card form-card">
              <h2>Recent orders</h2>
              {d.recent_orders.length === 0 ? <Empty title="No orders yet">New orders will appear here.</Empty> : (
                <ul className="list">{d.recent_orders.map((o) => (
                  <li key={o.id}><Link to={'/admin/orders/' + o.id}><strong>{o.order_code}</strong> <span>{o.customer_name}</span></Link><span>{money(o.total)}</span><StatusBadge status={o.status} /><small>{fmtDate(o.created_at)}</small></li>
                ))}</ul>
              )}
            </section>
            <section className="card form-card">
              <h2>Low stock <small className="muted">(at or below {d.low_stock_threshold})</small></h2>
              {d.low_stock.length === 0 ? <p className="muted">Nothing is running low.</p> : (
                <ul className="list">{d.low_stock.map((v) => (
                  <li key={v.variant_id}><Link to={'/admin/products/' + v.product_id}><strong>{v.product_name}</strong> <span>{v.label}</span></Link><span className={v.stock_qty === 0 ? 'stock-out' : 'stock-low'}>{v.stock_qty === 0 ? 'Out of stock' : v.stock_qty + ' left'}</span></li>
                ))}</ul>
              )}
              <Link to="/admin/inventory" className="btn btn-small">Update stock</Link>
            </section>
          </div>
        </>
      )}</Load>
    </Page>
  );
}
const Stat = ({ label, value, tone = '', to, wide }) => {
  const inner = <><span>{label}</span><strong>{value}</strong></>;
  return to ? <Link to={to} className={'stat ' + tone + (wide ? ' wide' : '')}>{inner}</Link> : <div className={'stat ' + tone + (wide ? ' wide' : '')}>{inner}</div>;
};
