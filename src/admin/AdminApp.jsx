import { useEffect, useState } from 'react';
import { Link, useRouter } from '../lib/router.jsx';
import { getSession, onSession, signIn, signOut, adminRpc } from '../lib/api.js';
import { Logo, IconMenu } from '../components/art.jsx';
import { Field, Spinner, Toasts } from '../components/ui.jsx';
import { useShop } from '../lib/shop.jsx';
import Dashboard from './Dashboard.jsx';
import { OrdersList, OrderDetail } from './Orders.jsx';
import { ProductsList, ProductEditor } from './Products.jsx';
import { Categories, Inventory } from './Catalog.jsx';
import { Delivery, Reports, Notifications, Settings } from './Config.jsx';

function Login({ denied }) {
  const [email, setEmail] = useState(''); const [pw, setPw] = useState(''); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  async function go(e) {
    e.preventDefault(); setErr(null); setBusy(true);
    try { await signIn(email.trim(), pw); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  }
  return (
    <main className="login-page">
      <form className="card login-card" onSubmit={go}>
        <Logo size={56} />
        <h1>Shop owner sign in</h1>
        <p className="muted">Only the shop owner can open the admin panel.</p>
        {denied && <div className="alert alert-err" role="alert">This account is not the shop owner, so it cannot use the admin panel.<br /><button type="button" className="btn btn-small" onClick={() => signOut()}>Sign out</button></div>}
        <Field label="Email"><input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
        <Field label="Password"><input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required /></Field>
        {err && <div className="alert alert-err" role="alert">{err}</div>}
        <button className="btn btn-primary btn-block btn-lg" disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</button>
        <Link to="/" className="center-link">&larr; Back to the shop</Link>
      </form>
    </main>
  );
}

const NAV = [['/admin', 'Dashboard'], ['/admin/orders', 'Orders'], ['/admin/products', 'Products'], ['/admin/categories', 'Categories'], ['/admin/inventory', 'Inventory'], ['/admin/delivery', 'Delivery'], ['/admin/reports', 'Reports'], ['/admin/notifications', 'Notifications'], ['/admin/settings', 'Shop settings']];

function Panel({ session }) {
  const { path } = useRouter();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  let page; let m;
  if (path === '/admin') page = <Dashboard />;
  else if (path === '/admin/orders') page = <OrdersList />;
  else if ((m = path.match(/^\/admin\/orders\/([0-9a-f-]{36})$/))) page = <OrderDetail id={m[1]} key={m[1]} />;
  else if (path === '/admin/products') page = <ProductsList />;
  else if (path === '/admin/products/new') page = <ProductEditor key="new" />;
  else if ((m = path.match(/^\/admin\/products\/([0-9a-f-]{36})$/))) page = <ProductEditor id={m[1]} key={m[1]} />;
  else if (path === '/admin/categories') page = <Categories />;
  else if (path === '/admin/inventory') page = <Inventory />;
  else if (path === '/admin/delivery') page = <Delivery />;
  else if (path === '/admin/reports') page = <Reports />;
  else if (path === '/admin/notifications') page = <Notifications />;
  else if (path === '/admin/settings') page = <Settings />;
  else page = <div className="card form-card"><h2>Page not found</h2><Link to="/admin" className="btn">Back to dashboard</Link></div>;
  const active = (to) => (to === '/admin' ? path === '/admin' : path.startsWith(to));
  return (
    <div className="admin">
      <header className="admin-top">
        <button className="icon-btn menu-btn" onClick={() => setOpen(!open)} aria-label="Menu"><IconMenu /></button>
        <Logo size={32} /><strong>Admin panel</strong>
        <span className="spacer" />
        <span className="muted small hide-sm">{session.email}</span>
        <Link to="/" className="btn btn-small btn-ghost">View shop</Link>
        <button className="btn btn-small" onClick={() => signOut()}>Sign out</button>
      </header>
      <div className="admin-body">
        <nav className={'admin-nav' + (open ? ' is-open' : '')} aria-label="Admin menu">
          {NAV.map(([to, label]) => <Link key={to} to={to} className={active(to) ? 'is-on' : ''}>{label}</Link>)}
        </nav>
        <main className="admin-main">{page}</main>
      </div>
      <Toasts />
    </div>
  );
}

export default function AdminApp() {
  const [session, setSession] = useState(getSession());
  const [state, setState] = useState('checking');   // checking | ok | denied
  const { toast } = useShop();
  useEffect(() => onSession(setSession), []);
  useEffect(() => {
    document.title = 'Admin | Mandal Masala Bhandar';
    if (!session) { setState('checking'); return undefined; }
    let live = true; setState('checking');
    adminRpc('is_admin').then((ok) => live && setState(ok === true ? 'ok' : 'denied'), (e) => { if (live) { toast(e.message, 'err'); setState('denied'); } });
    return () => { live = false; };
  }, [session && session.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!session) return <Login />;
  if (state === 'checking') return <div className="wrap section"><Spinner label="Checking your access..." /></div>;
  if (state === 'denied') return <Login denied />;
  return <Panel session={session} />;
}
