import { Link } from '../lib/router.jsx';
import { useShop } from '../lib/shop.jsx';
import { BuyBox, ProductImage, ProductGrid } from '../components/Product.jsx';
import { Spinner, ErrorBox, Empty } from '../components/ui.jsx';

export default function ProductPage({ slug }) {
  const { catalog, index, error, reload } = useShop();
  if (error) return <div className="wrap section"><ErrorBox error={error} onRetry={reload} /></div>;
  if (!catalog) return <div className="wrap section"><Spinner /></div>;
  const p = catalog.products.find((x) => x.slug === slug);
  if (!p) return <div className="wrap section"><Empty title="Product not found">This product is not available. <Link to="/shop">Browse all products</Link></Empty></div>;
  const cat = index.byCat.get(p.category_id);
  const related = catalog.products.filter((x) => x.category_id === p.category_id && x.id !== p.id).slice(0, 4);
  return (
    <div className="wrap section">
      <nav className="crumbs"><Link to="/shop">Shop</Link> / {cat && <Link to={'/shop?cat=' + cat.slug}>{cat.name}</Link>} / <span>{p.name}</span></nav>
      <div className="pdetail">
        <div className="pdetail-img"><ProductImage product={p} category={cat} /></div>
        <div>
          <div className="pcat">{cat?.name}</div>
          <h1 className="h1">{p.name}</h1>
          {p.short_description && <p className="lead">{p.short_description}</p>}
          <BuyBox product={p} />
          {p.description && <div className="pdesc-long"><h3>About this product</h3><p>{p.description}</p></div>}
          <p className="muted small">Cash on delivery. Local delivery only.</p>
        </div>
      </div>
      {related.length > 0 && <><h2 className="h2">You may also like</h2><ProductGrid products={related} /></>}
    </div>
  );
}
