import { lazy, Suspense } from 'react';
import { Router, useRouter } from './lib/router.jsx';
import { ShopProvider } from './lib/shop.jsx';
import { configured } from './lib/api.js';
import { Shell } from './components/Layout.jsx';
import { Spinner } from './components/ui.jsx';
import Home from './pages/Home.jsx';
import Shop from './pages/Shop.jsx';
import ProductPage from './pages/ProductPage.jsx';
import Cart from './pages/Cart.jsx';
import Checkout from './pages/Checkout.jsx';
import OrderSuccess from './pages/OrderSuccess.jsx';
import Track from './pages/Track.jsx';
import { About, Contact, Policies, NotFound, SetupNeeded } from './pages/Info.jsx';

const Admin = lazy(() => import('./admin/AdminApp.jsx'));   // the owner panel is a separate download

function Routes() {
  const { path } = useRouter();
  if (path === '/admin' || path.startsWith('/admin/')) return <Suspense fallback={<div className="wrap section"><Spinner label="Loading admin..." /></div>}><Admin /></Suspense>;
  let page;
  if (path === '/') page = <Home />;
  else if (path === '/shop') page = <Shop />;
  else if (path.startsWith('/product/')) page = <ProductPage slug={decodeURIComponent(path.slice(9))} />;
  else if (path === '/cart') page = <Cart />;
  else if (path === '/checkout') page = <Checkout />;
  else if (path === '/order-success') page = <OrderSuccess />;
  else if (path === '/track') page = <Track />;
  else if (path === '/about') page = <About />;
  else if (path === '/contact') page = <Contact />;
  else if (path === '/policies') page = <Policies />;
  else page = <NotFound />;
  return <Shell>{page}</Shell>;
}

export default function App() {
  if (!configured) return <main><SetupNeeded /></main>;
  return <Router><ShopProvider><Routes /></ShopProvider></Router>;
}
