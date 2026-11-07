import { Link, useRouter } from '../lib/router.jsx';
import { useShop } from '../lib/shop.jsx';
import { Logo, IconCart, IconHome, IconShop, IconTrack } from './art.jsx';
import { Toasts } from './ui.jsx';

export function Header() {
  const { count, store } = useShop();
  const { path } = useRouter();
  const on = (p) => (path === p || (p !== '/' && path.startsWith(p)) ? 'is-on' : '');
  return (
    <>
      {store?.announcement && <div className="announce">{store.announcement}</div>}
      <header className="header">
        <div className="wrap header-in">
          <Link to="/" className="brand" aria-label="Mandal Masala Bhandar home">
            <Logo size={42} />
            <span className="brand-text"><span className="brand-name">Mandal Masala Bhandar</span><span className="brand-sub">Spices &amp; Dry Fruits &middot; Beldanga</span></span>
          </Link>
          <nav className="nav" aria-label="Main">
            <Link to="/" className={on('/') && path === '/' ? 'is-on' : ''}>Home</Link>
            <Link to="/shop" className={on('/shop')}>Shop</Link>
            <Link to="/about" className={on('/about')}>About</Link>
            <Link to="/contact" className={on('/contact')}>Contact</Link>
            <Link to="/track" className={on('/track')}>Track order</Link>
          </nav>
          <Link to="/cart" className="cart-btn" aria-label={`Cart, ${count} items`}>
            <IconCart size={22} /><span className="cart-label">Cart</span>
            {count > 0 && <span className="cart-count">{count}</span>}
          </Link>
        </div>
      </header>
    </>
  );
}

export function BottomNav() {
  const { path } = useRouter();
  const { count } = useShop();
  const items = [['/', 'Home', IconHome], ['/shop', 'Shop', IconShop], ['/cart', 'Cart', IconCart], ['/track', 'Track', IconTrack]];
  return (
    <nav className="bottom-nav" aria-label="Quick links">
      {items.map(([to, label, Ic]) => (
        <Link key={to} to={to} className={(to === '/' ? path === '/' : path.startsWith(to)) ? 'is-on' : ''}>
          <span className="bn-icon"><Ic size={22} />{to === '/cart' && count > 0 && <span className="cart-count">{count}</span>}</span>{label}
        </Link>
      ))}
    </nav>
  );
}

export function Footer() {
  const { store } = useShop();
  if (!store) return <footer className="footer"><div className="wrap">Mandal Masala Bhandar</div></footer>;
  return (
    <footer className="footer">
      <div className="wrap footer-grid">
        <div>
          <div className="footer-brand"><Logo size={36} /><strong>{store.shop_name}</strong></div>
          <p>{store.tagline}</p>
          <p>{store.address}</p>
        </div>
        <div>
          <h4>Shop</h4>
          <Link to="/shop">All products</Link><Link to="/cart">Your cart</Link><Link to="/track">Track your order</Link>
        </div>
        <div>
          <h4>Information</h4>
          <Link to="/about">About us</Link><Link to="/contact">Contact &amp; delivery areas</Link><Link to="/policies">Delivery, returns &amp; privacy</Link>
        </div>
        <div>
          <h4>Contact</h4>
          {store.contact_phone ? <a href={'tel:' + store.contact_phone.replace(/[^\d+]/g, '')}>{store.contact_phone}</a> : <span>Phone: coming soon</span>}
          {store.opening_hours && <span>{store.opening_hours}</span>}
          <span>Cash on delivery only</span>
        </div>
      </div>
      <div className="wrap footer-base">&copy; {new Date().getFullYear()} {store.shop_name}. All rights reserved.</div>
    </footer>
  );
}

export function Shell({ children }) {
  return (
    <>
      <Header />
      <main id="main">{children}</main>
      <Footer />
      <BottomNav />
      <Toasts />
    </>
  );
}
