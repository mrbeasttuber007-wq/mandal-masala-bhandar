import { useRef, useState } from 'react';
import { Link, useRouter } from '../lib/router.jsx';
import { adminRpc, uploadProductImage } from '../lib/api.js';
import { useAsync, money } from '../lib/util.js';
import { Field, Switch, Empty } from '../components/ui.jsx';
import { ProductArt } from '../components/art.jsx';
import { Page, Load, useAction } from './ui.jsx';

export function ProductsList() {
  const st = useAsync(() => adminRpc('admin_list_products'));
  const [busy, run] = useAction();
  const [q, setQ] = useState('');
  const toggle = (p) => run(async () => { await adminRpc('admin_save_product', { p: { id: p.id, category_id: p.category_id, name: p.name, is_active: !p.is_active } }); st.reload(); }, p.is_active ? 'Product hidden from the shop' : 'Product is now visible');
  const del = (p) => { if (confirm(`Delete "${p.name}" and all its pack sizes? Past orders keep their details. This cannot be undone.`)) run(async () => { await adminRpc('admin_delete_product', { p_id: p.id }); st.reload(); }, 'Product deleted'); };
  return (
    <Page title="Products" actions={<Link to="/admin/products/new" className="btn btn-primary btn-small">+ Add product</Link>}>
      <input className="search-box" placeholder="Search products..." value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search products" />
      <Load state={st}>{(list) => {
        const rows = list.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase()));
        if (list.length === 0) return <Empty title="No products yet">Add your first product with its pack sizes and prices.<div><Link to="/admin/products/new" className="btn btn-primary">+ Add product</Link></div></Empty>;
        return (
          <div className="card table-card"><table className="table responsive">
            <thead><tr><th>Product</th><th>Category</th><th>Pack sizes</th><th>Visible</th><th /></tr></thead>
            <tbody>{rows.map((p) => (
              <tr key={p.id} className={p.is_active ? '' : 'is-off'}>
                <td data-label="Product"><div className="prod-cell"><div className="thumb">{p.image_url ? <img src={p.image_url} alt="" /> : <ProductArt name={p.name} />}</div><div><Link to={'/admin/products/' + p.id}><strong>{p.name}</strong></Link><br /><small>{p.is_featured ? 'Featured ' : ''}{p.is_best_seller ? 'Best seller' : ''}</small></div></div></td>
                <td data-label="Category">{p.category_name}</td>
                <td data-label="Pack sizes">{p.variants.length === 0 ? <em className="muted">none yet</em> : p.variants.map((v) => <span key={v.id} className={'mini-v' + (v.stock_qty === 0 || !v.is_available ? ' out' : '')}>{v.label} {money(v.price)} <small>({v.stock_qty})</small></span>)}</td>
                <td data-label="Visible"><Switch checked={p.is_active} onChange={() => toggle(p)} disabled={busy} /></td>
                <td className="actions"><Link to={'/admin/products/' + p.id} className="btn btn-small">Edit</Link> <button className="btn btn-small btn-danger" disabled={busy} onClick={() => del(p)}>Delete</button></td>
              </tr>))}</tbody>
          </table></div>
        );
      }}</Load>
    </Page>
  );
}

/** Shrinks a phone photo to about 1000px so it uploads fast on mobile data (max 2 MB allowed). */
async function shrink(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Please choose a JPG, PNG or WebP photo.');
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1000 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.85));
  if (!blob) throw new Error('Could not prepare the photo.');
  if (blob.size > 2 * 1024 * 1024) throw new Error('This photo is still larger than 2 MB. Please pick a smaller one.');
  return blob;
}

const blankVariant = () => ({ _key: Math.random().toString(36).slice(2), label: '', price: '', compare_at_price: '', stock_qty: '0', is_available: true });
const PRESETS = ['100g', '250g', '500g', '1kg'];

export function ProductEditor({ id }) {
  const { navigate } = useRouter();
  const cats = useAsync(() => adminRpc('admin_list_categories'));
  const prod = useAsync(async () => {
    if (!id) return { is_active: true, variants: [] };
    const all = await adminRpc('admin_list_products');
    const p = all.find((x) => x.id === id);
    if (!p) throw new Error('Product not found.');
    return p;
  }, [id]);
  const [busy, run] = useAction();
  const [up, setUp] = useState(false);
  const [f, setF] = useState(null);
  const [removed, setRemoved] = useState([]);
  const fileRef = useRef();

  // copy loaded data into the editable form once
  if (prod.data && !f) {
    const p = prod.data;
    setF({ name: p.name || '', category_id: p.category_id || '', short_description: p.short_description || '', description: p.description || '', image_url: p.image_url || '',
      is_active: p.is_active !== false, is_featured: !!p.is_featured, is_best_seller: !!p.is_best_seller,
      variants: (p.variants || []).map((v) => ({ ...v, _key: v.id, price: String(v.price), compare_at_price: v.compare_at_price == null ? '' : String(v.compare_at_price), stock_qty: String(v.stock_qty) })) });
  }
  if (prod.error) return <Page title="Product"><Load state={prod}>{() => null}</Load></Page>;
  if (!f || !cats.data) return <Page title={id ? 'Edit product' : 'Add product'}><Load state={prod.loading || !f ? { ...prod, data: null } : cats}>{() => null}</Load></Page>;

  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const setV = (key, k, v) => setF((x) => ({ ...x, variants: x.variants.map((r) => (r._key === key ? { ...r, [k]: v } : r)) }));
  const addV = (label = '') => setF((x) => ({ ...x, variants: [...x.variants, { ...blankVariant(), label }] }));
  const delV = (r) => { if (r.id) setRemoved((a) => [...a, r.id]); setF((x) => ({ ...x, variants: x.variants.filter((v) => v._key !== r._key) })); };

  async function pick(e) {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    setUp(true);
    const r = await run(async () => { const blob = await shrink(file); return uploadProductImage(blob, 'jpg'); }, 'Photo uploaded');
    setUp(false);
    if (r.ok) set('image_url', r.data);
  }

  async function save(e) {
    e.preventDefault();
    if (f.name.trim().length < 2) return run(async () => { throw new Error('Please enter a product name.'); });
    if (!f.category_id) return run(async () => { throw new Error('Please choose a category.'); });
    const labels = f.variants.map((v) => v.label.trim().toLowerCase());
    if (new Set(labels).size !== labels.length) return run(async () => { throw new Error('Each pack size can be added only once (for example only one 250g).'); });
    const body = { id: id || null, category_id: f.category_id, name: f.name, short_description: f.short_description, description: f.description, image_url: f.image_url,
      is_active: f.is_active, is_featured: f.is_featured, is_best_seller: f.is_best_seller, remove_variant_ids: removed,
      variants: f.variants.map((v, i) => ({ id: v.id || null, label: v.label, price: v.price === '' ? null : Number(v.price), compare_at_price: v.compare_at_price === '' ? null : Number(v.compare_at_price),
        stock_qty: v.stock_qty === '' ? 0 : Math.max(0, parseInt(v.stock_qty, 10) || 0), is_available: v.is_available, sort_order: i })) };
    const r = await run(() => adminRpc('admin_save_product', { p: body }), 'Product saved');
    if (r.ok) navigate('/admin/products');
  }
  async function del() {
    if (!confirm('Delete this product and all its pack sizes? This cannot be undone.')) return;
    const r = await run(() => adminRpc('admin_delete_product', { p_id: id }), 'Product deleted');
    if (r.ok) navigate('/admin/products');
  }

  return (
    <Page title={id ? 'Edit product' : 'Add product'} actions={<Link to="/admin/products" className="btn btn-small">&larr; Products</Link>}>
      <form onSubmit={save} className="card form-card" noValidate>
        <div className="editor-top">
          <div className="img-box">
            <div className="img-preview">{f.image_url ? <img src={f.image_url} alt="Product" /> : <ProductArt name={f.name} />}</div>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={pick} />
            <button type="button" className="btn btn-small" disabled={up || busy} onClick={() => fileRef.current.click()}>{up ? 'Uploading...' : f.image_url ? 'Change photo' : 'Upload photo'}</button>
            {f.image_url && <button type="button" className="link-danger" onClick={() => set('image_url', '')}>Remove photo</button>}
            <small className="muted">JPG, PNG or WebP. It is shrunk automatically.</small>
          </div>
          <div className="form-grid">
            <Field label="Product name *" className="span2"><input value={f.name} onChange={(e) => set('name', e.target.value)} maxLength={120} /></Field>
            <Field label="Category *"><select value={f.category_id} onChange={(e) => set('category_id', e.target.value)}><option value="">Choose...</option>{cats.data.map((c) => <option key={c.id} value={c.id}>{c.name}{c.is_active ? '' : ' (hidden)'}</option>)}</select></Field>
            <Field label="Short description"><input value={f.short_description} onChange={(e) => set('short_description', e.target.value)} maxLength={200} /></Field>
            <Field label="Full description" className="span2"><textarea rows={4} value={f.description} onChange={(e) => set('description', e.target.value)} maxLength={2000} /></Field>
          </div>
        </div>
        <div className="switches"><Switch checked={f.is_active} onChange={(v) => set('is_active', v)} label="Visible in the shop" /><Switch checked={f.is_featured} onChange={(v) => set('is_featured', v)} label="Featured on home page" /><Switch checked={f.is_best_seller} onChange={(v) => set('is_best_seller', v)} label="Best seller" /></div>

        <h2>Pack sizes, prices and stock</h2>
        <p className="muted small">Each pack size has its own price, stock and availability. Stock goes down automatically when an order is placed.</p>
        <div className="variants">
          {f.variants.length === 0 && <p className="alert alert-warn">Add at least one pack size, or customers cannot buy this product.</p>}
          {f.variants.map((v) => (
            <div key={v._key} className="variant-row">
              <Field label="Pack size"><input value={v.label} onChange={(e) => setV(v._key, 'label', e.target.value)} placeholder="e.g. 250g" maxLength={30} /></Field>
              <Field label="Price (Rs.)"><input inputMode="decimal" value={v.price} onChange={(e) => setV(v._key, 'price', e.target.value.replace(/[^\d.]/g, ''))} /></Field>
              <Field label="Old price (optional)" hint="Crossed out"><input inputMode="decimal" value={v.compare_at_price} onChange={(e) => setV(v._key, 'compare_at_price', e.target.value.replace(/[^\d.]/g, ''))} /></Field>
              <Field label="Stock"><input inputMode="numeric" value={v.stock_qty} onChange={(e) => setV(v._key, 'stock_qty', e.target.value.replace(/\D/g, ''))} /></Field>
              <div className="variant-end"><Switch checked={v.is_available} onChange={(x) => setV(v._key, 'is_available', x)} label="On sale" /><button type="button" className="link-danger" onClick={() => delV(v)}>Remove</button></div>
            </div>
          ))}
        </div>
        <div className="row-actions"><span className="muted small">Quick add:</span>{PRESETS.filter((p) => !f.variants.some((v) => v.label.trim().toLowerCase() === p)).map((p) => <button type="button" key={p} className="btn btn-small" onClick={() => addV(p)}>+ {p}</button>)}<button type="button" className="btn btn-small" onClick={() => addV()}>+ Other size</button></div>

        <div className="form-actions"><button className="btn btn-primary btn-lg" disabled={busy || up}>{busy ? 'Saving...' : 'Save product'}</button>{id && <button type="button" className="btn btn-danger" disabled={busy} onClick={del}>Delete product</button>}</div>
      </form>
    </Page>
  );
}
