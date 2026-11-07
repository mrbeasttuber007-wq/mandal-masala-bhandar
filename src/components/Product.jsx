import { useState } from 'react';
import { Link } from '../lib/router.jsx';
import { useShop } from '../lib/shop.jsx';
import { money } from '../lib/util.js';
import { ProductArt } from './art.jsx';

export function ProductImage({ product, category }) {
  const [bad, setBad] = useState(false);
  return (
    <div className="pimg">
      {product.image_url && !bad
        ? <img src={product.image_url} alt={product.name} loading="lazy" decoding="async" onError={() => setBad(true)} />
        : <ProductArt slug={category?.slug} name={product.name} />}
    </div>
  );
}

export const stockInfo = (v) => (!v ? null : !v.in_stock ? { text: 'Out of stock', cls: 'stock-out' } : v.low_stock ? { text: 'Only a few left', cls: 'stock-low' } : { text: 'In stock', cls: 'stock-in' });

/** Pack-size picker + price + stock + Add to cart. Used on cards and on the product page. */
export function BuyBox({ product, compact }) {
  const { add, toast } = useShop();
  const first = product.variants.find((v) => v.in_stock) || product.variants[0];
  const [vid, setVid] = useState(first?.id);
  const [qty, setQty] = useState(1);
  const v = product.variants.find((x) => x.id === vid) || first;
  if (!v) return <p className="muted">No pack sizes available yet.</p>;
  const st = stockInfo(v);
  const off = v.compare_at_price && v.compare_at_price > v.price ? Math.round((1 - v.price / v.compare_at_price) * 100) : 0;
  return (
    <div className="buybox">
      <div className="chips" role="radiogroup" aria-label="Pack size">
        {product.variants.map((x) => (
          <button key={x.id} type="button" role="radio" aria-checked={x.id === v.id} className={'chip' + (x.id === v.id ? ' is-on' : '') + (!x.in_stock ? ' is-out' : '')} onClick={() => setVid(x.id)}>{x.label}</button>
        ))}
      </div>
      <div className="price-row">
        <span className="price">{money(v.price)}</span>
        {off > 0 && <><s className="price-old">{money(v.compare_at_price)}</s><span className="off">{off}% off</span></>}
        <span className={'stock ' + st.cls}>{st.text}</span>
      </div>
      <div className="buy-actions">
        {!compact && (
          <div className="qty" aria-label="Quantity">
            <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Fewer">&minus;</button>
            <span>{qty}</span>
            <button type="button" onClick={() => setQty((q) => Math.min(100, q + 1))} aria-label="More">+</button>
          </div>
        )}
        <button className="btn btn-primary btn-block" disabled={!v.in_stock} onClick={() => { add(v.id, compact ? 1 : qty); toast(`Added ${product.name} (${v.label}) to your cart`); }}>
          {v.in_stock ? 'Add to cart' : 'Out of stock'}
        </button>
      </div>
    </div>
  );
}

export function ProductCard({ product }) {
  const { index } = useShop();
  const cat = index.byCat.get(product.category_id);
  return (
    <article className="card pcard">
      <Link to={'/product/' + product.slug} className="pcard-top" aria-label={product.name}>
        <ProductImage product={product} category={cat} />
        {product.is_best_seller && <span className="ribbon">Best seller</span>}
      </Link>
      <div className="pcard-body">
        <div className="pcat">{cat?.name}</div>
        <h3 className="pname"><Link to={'/product/' + product.slug}>{product.name}</Link></h3>
        {product.short_description && <p className="pdesc">{product.short_description}</p>}
        <BuyBox product={product} compact />
      </div>
    </article>
  );
}

export function ProductGrid({ products }) {
  return <div className="grid">{products.map((p) => <ProductCard key={p.id} product={p} />)}</div>;
}
