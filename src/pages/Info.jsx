import { useShop } from '../lib/shop.jsx';
import { Link } from '../lib/router.jsx';
import { Spinner, ErrorBox } from '../components/ui.jsx';
import { money } from '../lib/util.js';
import { IconPhone, IconPin, IconWhatsApp } from '../components/art.jsx';
import { waLink } from '../lib/util.js';

function useStore() { const { store, error, reload } = useShop(); return { store, error, reload }; }
const Wait = ({ store, error, reload }) => error ? <div className="wrap section"><ErrorBox error={error} onRetry={reload} /></div> : <div className="wrap section"><Spinner /></div>;
const Text = ({ text }) => String(text || '').split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>);

export function About() {
  const s = useStore(); const { store } = s;
  if (!store) return <Wait {...s} />;
  return (
    <div className="wrap section narrow">
      <h1 className="h1">About {store.shop_name}</h1>
      <Text text={store.about_text} />
      <p><strong>Find us:</strong> {store.address}</p>
      <p><Link to="/shop" className="btn btn-primary">Shop our products</Link></p>
    </div>
  );
}

export function Contact() {
  const s = useStore(); const { store } = s;
  if (!store) return <Wait {...s} />;
  const zones = store.delivery_zones || [];
  const wa = store.contact_whatsapp || store.contact_phone;
  return (
    <div className="wrap section narrow">
      <h1 className="h1">Contact us</h1>
      <div className="card form-card contact-list">
        <p><IconPin size={20} /> <span>{store.address}</span></p>
        {store.contact_phone ? <p><IconPhone size={20} /> <a href={'tel:' + store.contact_phone.replace(/[^\d+]/g, '')}>{store.contact_phone}</a></p> : <p className="muted">Phone number will be added soon.</p>}
        {wa && <p><IconWhatsApp size={20} /> <a href={waLink(wa, 'Hello Mandal Masala Bhandar, I have a question.')} target="_blank" rel="noopener noreferrer">Chat on WhatsApp</a></p>}
        {store.contact_email && <p>Email: <a href={'mailto:' + store.contact_email}>{store.contact_email}</a></p>}
        {store.opening_hours && <p>Opening hours: {store.opening_hours}</p>}
      </div>
      <h2 className="h2">Delivery areas</h2>
      {zones.length === 0 ? <p>Delivery areas will be announced soon.</p> : (
        <div className="card table-card"><table className="table"><thead><tr><th>Area</th><th>PIN codes</th><th>Delivery</th><th>Minimum order</th></tr></thead><tbody>
          {zones.map((z) => <tr key={z.name}><td>{z.name}</td><td>{z.pin_codes.join(', ')}</td><td>{z.delivery_charge === 0 ? 'Free' : money(z.delivery_charge)}{z.free_delivery_threshold ? `; free above ${money(z.free_delivery_threshold)}` : ''}</td><td>{z.min_order_value > 0 ? money(z.min_order_value) : 'None'}</td></tr>)}
        </tbody></table></div>
      )}
      <p className="muted">Payment is cash on delivery only.</p>
    </div>
  );
}

export function Policies() {
  const s = useStore(); const { store } = s;
  if (!store) return <Wait {...s} />;
  return (
    <div className="wrap section narrow">
      <h1 className="h1">Policies</h1>
      <h2 className="h3">Delivery &amp; payment</h2><Text text={store.delivery_policy} />
      <h2 className="h3">Returns &amp; problems</h2><Text text={store.return_policy} />
      <h2 className="h3">Privacy</h2><Text text={store.privacy_policy} />
      <h2 className="h3">Terms</h2><Text text={store.terms_text} />
    </div>
  );
}

export function NotFound() {
  return <div className="wrap section narrow center"><h1 className="h1">Page not found</h1><p>We could not find that page.</p><Link className="btn btn-primary" to="/">Go to the home page</Link></div>;
}

export function SetupNeeded() {
  return (
    <div className="wrap section narrow">
      <h1 className="h1">Almost ready</h1>
      <div className="alert alert-warn">
        <strong>This website is not connected to its database yet.</strong>
        <p>The site owner needs to add two settings (<code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>) in the hosting dashboard and redeploy. The step-by-step guide is in <code>docs/SETUP-GUIDE.md</code>.</p>
      </div>
    </div>
  );
}
