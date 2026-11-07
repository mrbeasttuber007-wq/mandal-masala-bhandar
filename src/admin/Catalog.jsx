import { useState } from 'react';
import { adminRpc } from '../lib/api.js';
import { useAsync } from '../lib/util.js';
import { Field, Switch, Modal, Empty } from '../components/ui.jsx';
import { Page, Load, useAction } from './ui.jsx';
import { Link } from '../lib/router.jsx';

export function Categories() {
  const st = useAsync(() => adminRpc('admin_list_categories'));
  const [edit, setEdit] = useState(null);
  const [busy, run] = useAction();
  const save = async (e) => {
    e.preventDefault();
    const r = await run(() => adminRpc('admin_save_category', { p: { ...edit, sort_order: edit.sort_order === '' ? 0 : Number(edit.sort_order) } }), 'Category saved');
    if (r.ok) { setEdit(null); st.reload(); }
  };
  const del = (c) => { if (confirm(`Delete the category "${c.name}"?`)) run(async () => { await adminRpc('admin_delete_category', { p_id: c.id }); st.reload(); }, 'Category deleted'); };
  const toggle = (c) => run(async () => { await adminRpc('admin_save_category', { p: { id: c.id, name: c.name, description: c.description, sort_order: c.sort_order, is_active: !c.is_active } }); st.reload(); });
  return (
    <Page title="Categories" actions={<button className="btn btn-primary btn-small" onClick={() => setEdit({ name: '', description: '', sort_order: 0, is_active: true })}>+ Add category</button>}>
      <Load state={st}>{(list) => list.length === 0 ? <Empty title="No categories">Add a category such as Whole Spices.</Empty> : (
        <div className="card table-card"><table className="table responsive"><thead><tr><th>Name</th><th>Description</th><th>Products</th><th>Visible</th><th /></tr></thead><tbody>
          {list.map((c) => <tr key={c.id}><td data-label="Name"><strong>{c.name}</strong></td><td data-label="Description">{c.description}</td><td data-label="Products">{c.product_count}</td>
            <td data-label="Visible"><Switch checked={c.is_active} onChange={() => toggle(c)} disabled={busy} /></td>
            <td className="actions"><button className="btn btn-small" onClick={() => setEdit({ ...c, description: c.description || '' })}>Edit</button> <button className="btn btn-small btn-danger" disabled={busy} onClick={() => del(c)}>Delete</button></td></tr>)}
        </tbody></table></div>
      )}</Load>
      {edit && (
        <Modal title={edit.id ? 'Edit category' : 'Add category'} onClose={() => setEdit(null)}>
          <form onSubmit={save} className="form-grid one">
            <Field label="Name *"><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} maxLength={60} autoFocus /></Field>
            <Field label="Description"><textarea rows={2} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} maxLength={200} /></Field>
            <Field label="Display order" hint="Smaller numbers appear first"><input inputMode="numeric" value={edit.sort_order} onChange={(e) => setEdit({ ...edit, sort_order: e.target.value.replace(/\D/g, '') })} /></Field>
            <Switch checked={edit.is_active} onChange={(v) => setEdit({ ...edit, is_active: v })} label="Visible in the shop" />
            <div className="form-actions"><button className="btn btn-primary" disabled={busy}>{busy ? 'Saving...' : 'Save'}</button><button type="button" className="btn" onClick={() => setEdit(null)}>Cancel</button></div>
          </form>
        </Modal>
      )}
    </Page>
  );
}

function StockRow({ v, threshold, onSaved }) {
  const [stock, setStock] = useState(String(v.stock_qty));
  const [avail, setAvail] = useState(v.is_available);
  const [busy, run] = useAction();
  const dirty = stock !== String(v.stock_qty) || avail !== v.is_available;
  const n = parseInt(stock, 10);
  return (
    <tr className={n === 0 ? 'row-out' : n <= threshold ? 'row-low' : ''}>
      <td data-label="Product"><Link to={'/admin/products/' + v.product_id}><strong>{v.product_name}</strong></Link></td>
      <td data-label="Pack size">{v.label}</td>
      <td data-label="Stock"><input className="stock-input" inputMode="numeric" value={stock} onChange={(e) => setStock(e.target.value.replace(/\D/g, ''))} aria-label={`Stock for ${v.product_name} ${v.label}`} /></td>
      <td data-label="On sale"><Switch checked={avail} onChange={setAvail} /></td>
      <td className="actions"><button className="btn btn-small btn-primary" disabled={!dirty || busy || stock === ''} onClick={async () => { const r = await run(() => adminRpc('admin_set_variant_stock', { p_id: v.id, p_stock: n, p_available: avail }), 'Stock updated'); if (r.ok) onSaved(); }}>Save</button></td>
    </tr>
  );
}

export function Inventory() {
  const st = useAsync(async () => {
    const [products, dash] = await Promise.all([adminRpc('admin_list_products'), adminRpc('admin_dashboard')]);
    const rows = [];
    for (const p of products) for (const v of p.variants) rows.push({ ...v, product_name: p.name, product_id: p.id, p_active: p.is_active });
    return { rows, threshold: dash.low_stock_threshold };
  });
  const [low, setLow] = useState(false);
  return (
    <Page title="Inventory" actions={<Switch checked={low} onChange={setLow} label="Low stock only" />}>
      <p className="muted">Stock is tracked separately for every pack size. Change a number and press Save.</p>
      <Load state={st}>{({ rows, threshold }) => {
        const list = rows.filter((r) => !low || r.stock_qty <= threshold);
        if (rows.length === 0) return <Empty title="Nothing to track yet">Add products with pack sizes first.</Empty>;
        if (list.length === 0) return <Empty title="No low-stock items">Everything is above {threshold}.</Empty>;
        return <div className="card table-card"><table className="table responsive"><thead><tr><th>Product</th><th>Pack size</th><th>Stock</th><th>On sale</th><th /></tr></thead><tbody>
          {list.map((v) => <StockRow key={v.id + ':' + v.stock_qty + v.is_available} v={v} threshold={threshold} onSaved={st.reload} />)}
        </tbody></table></div>;
      }}</Load>
    </Page>
  );
}
