import { useMemo } from 'react';
import { useRouter, useQuery } from '../lib/router.jsx';
import { useShop } from '../lib/shop.jsx';
import { ProductGrid } from '../components/Product.jsx';
import { Spinner, ErrorBox, Empty } from '../components/ui.jsx';
import { IconSearch } from '../components/art.jsx';

const lowest = (p) => { const a = p.variants.filter((v) => v.in_stock); const src = a.length ? a : p.variants; return src.length ? Math.min(...src.map((v) => v.price)) : Infinity; };

export default function Shop() {
  const { catalog, error, reload } = useShop();
  const { navigate, path } = useRouter();
  const q = useQuery();
  const cat = q.get('cat') || '', term = q.get('q') || '', sort = q.get('sort') || 'name', only = q.get('stock') === '1';
  const set = (k, v) => { const n = new URLSearchParams(q); v ? n.set(k, v) : n.delete(k); const s = n.toString(); navigate(path + (s ? '?' + s : ''), { replace: true }); };

  const list = useMemo(() => {
    if (!catalog) return [];
    const c = catalog.categories.find((x) => x.slug === cat);
    const t = term.trim().toLowerCase();
    let r = catalog.products.filter((p) => (!c || p.category_id === c.id)
      && (!t || (p.name + ' ' + (p.short_description || '') + ' ' + (p.description || '')).toLowerCase().includes(t))
      && (!only || p.variants.some((v) => v.in_stock)));
    r = [...r];
    if (sort === 'price-asc') r.sort((a, b) => lowest(a) - lowest(b));
    else if (sort === 'price-desc') r.sort((a, b) => lowest(b) - lowest(a));
    else r.sort((a, b) => a.name.localeCompare(b.name));
    return r;
  }, [catalog, cat, term, sort, only]);

  if (error) return <div className="wrap section"><ErrorBox error={error} onRetry={reload} title="We could not load the products" /></div>;
  if (!catalog) return <div className="wrap section"><Spinner label="Loading products..." /></div>;
  return (
    <div className="wrap section">
      <h1 className="h1">Shop</h1>
      <div className="toolbar">
        <div className="search"><IconSearch size={18} /><input type="search" placeholder="Search spices, masalas, dry fruits..." value={term} onChange={(e) => set('q', e.target.value)} aria-label="Search products" /></div>
        <select value={sort} onChange={(e) => set('sort', e.target.value === 'name' ? '' : e.target.value)} aria-label="Sort products">
          <option value="name">Name A to Z</option><option value="price-asc">Price: low to high</option><option value="price-desc">Price: high to low</option>
        </select>
      </div>
      <div className="chips chips-scroll" role="tablist" aria-label="Categories">
        <button className={'chip' + (!cat ? ' is-on' : '')} onClick={() => set('cat', '')}>All</button>
        {catalog.categories.map((c) => <button key={c.id} className={'chip' + (cat === c.slug ? ' is-on' : '')} onClick={() => set('cat', c.slug)}>{c.name}</button>)}
        <label className="chip chip-check"><input type="checkbox" checked={only} onChange={(e) => set('stock', e.target.checked ? '1' : '')} /> In stock only</label>
      </div>
      <p className="muted result-count">{list.length} {list.length === 1 ? 'product' : 'products'}</p>
      {list.length === 0
        ? <Empty title={catalog.products.length === 0 ? 'No products yet' : 'No products found'}>{catalog.products.length === 0 ? 'The shop is still adding its products. Please check back soon.' : 'Try a different word, or clear the filters.'}{catalog.products.length > 0 && <div><button className="btn" onClick={() => navigate(path, { replace: true })}>Clear filters</button></div>}</Empty>
        : <ProductGrid products={list} />}
    </div>
  );
}
