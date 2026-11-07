import { Link } from '../lib/router.jsx';
import { useShop } from '../lib/shop.jsx';
import { Mandala } from '../components/art.jsx';
import { ProductGrid } from '../components/Product.jsx';
import { Spinner, ErrorBox, Empty } from '../components/ui.jsx';
import { money } from '../lib/util.js';

export default function Home() {
  const { catalog, store, error, reload } = useShop();
  if (error) return <div className="wrap section"><ErrorBox error={error} onRetry={reload} title="We could not load the shop" /></div>;
  if (!catalog || !store) return <div className="wrap section"><Spinner label="Opening the shop..." /></div>;
  const products = catalog.products;
  const featured = products.filter((p) => p.is_featured).slice(0, 8);
  const best = products.filter((p) => p.is_best_seller).slice(0, 8);
  const offers = products.filter((p) => p.variants.some((v) => v.in_stock && v.compare_at_price && v.compare_at_price > v.price)).slice(0, 8);
  const countBy = (id) => products.filter((p) => p.category_id === id).length;
  const zones = store.delivery_zones || [];
  return (
    <>
      <section className="hero">
        <Mandala className="hero-mandala" />
        <div className="wrap hero-in">
          <div className="hero-copy">
            <span className="eyebrow">Kalitala, Beldanga</span>
            <h1>{store.hero_title}</h1>
            <p>{store.hero_subtitle}</p>
            <div className="hero-cta">
              <Link to="/shop" className="btn btn-primary btn-lg">Shop now</Link>
              <Link to="/track" className="btn btn-ghost btn-lg">Track an order</Link>
            </div>
            <ul className="hero-points"><li>Cash on delivery</li><li>Local home delivery</li><li>Pick your pack size</li></ul>
          </div>
        </div>
      </section>

      <section className="wrap section">
        <h2 className="h2">Shop by category</h2>
        <div className="cat-grid">
          {catalog.categories.map((c) => (
            <Link key={c.id} to={'/shop?cat=' + c.slug} className={'cat-tile cat-' + c.slug}>
              <span className="cat-name">{c.name}</span>
              <span className="cat-desc">{c.description}</span>
              <span className="cat-count">{countBy(c.id)} {countBy(c.id) === 1 ? 'product' : 'products'} &rarr;</span>
            </Link>
          ))}
        </div>
      </section>

      {products.length === 0 && (
        <section className="wrap section">
          <Empty title="Our shelves are being stocked">Products will appear here very soon. You can still read about the shop below or contact us directly.</Empty>
        </section>
      )}

      {featured.length > 0 && <section className="wrap section"><div className="sec-head"><h2 className="h2">Featured products</h2><Link to="/shop">See all &rarr;</Link></div><ProductGrid products={featured} /></section>}
      {best.length > 0 && <section className="wrap section"><h2 className="h2">Best sellers</h2><ProductGrid products={best} /></section>}
      {offers.length > 0 && (
        <section className="offers"><div className="wrap section">
          <h2 className="h2">Special offers</h2><p className="muted">Pack sizes with a reduced price. Limited stock.</p>
          <ProductGrid products={offers} />
        </div></section>
      )}

      <section className="wrap section about">
        <div>
          <h2 className="h2">About the shop</h2>
          <p>{store.about_text}</p>
          <Link to="/about" className="btn btn-ghost">Read more</Link>
        </div>
        <div className="info-card">
          <h3>Where we deliver</h3>
          {zones.length === 0 ? <p>Delivery areas will be announced soon.</p> : (
            <ul className="zone-list">{zones.map((z) => (
              <li key={z.name}><strong>{z.name}</strong><span>PIN {z.pin_codes.join(', ')}</span>
                <span>{z.delivery_charge === 0 ? 'Free delivery' : money(z.delivery_charge) + ' delivery'}{z.free_delivery_threshold ? `, free above ${money(z.free_delivery_threshold)}` : ''}</span></li>
            ))}</ul>
          )}
          <p className="muted">Payment: cash on delivery only.</p>
        </div>
      </section>
    </>
  );
}
