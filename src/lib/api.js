// A tiny client for Supabase (database functions, sign-in, image upload, Edge Function).
// It uses only the PUBLIC anon key. Every permission is enforced by the database itself (Row Level Security
// and the owner checks inside each admin function), so nothing here can be abused to reach private data.
const BASE = (import.meta.env.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, '');
const KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();
export const configured = /^https?:\/\//.test(BASE) && KEY.length > 10;
export const publicImageUrl = (path) => `${BASE}/storage/v1/object/public/product-images/${path}`;

export class ApiError extends Error {
  constructor(message, { status = 0, hint = null, code = null } = {}) { super(message); this.status = status; this.hint = hint; this.code = code; }
}

// ---------------------------------------------------------------- owner session (kept in this browser only)
const SESSION_KEY = 'mmb.session.v1';
let session = null;
try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { session = null; }
const listeners = new Set();
function setSession(s) {
  session = s;
  try { s ? localStorage.setItem(SESSION_KEY, JSON.stringify(s)) : localStorage.removeItem(SESSION_KEY); } catch { /* private mode */ }
  listeners.forEach((f) => f(session));
}
export const getSession = () => session;
export const onSession = (f) => { listeners.add(f); return () => listeners.delete(f); };

async function raw(path, { method = 'GET', body, token, headers = {}, timeout = 25000, isBlob = false } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  let res;
  try {
    res = await fetch(BASE + path, {
      method, signal: ctl.signal,
      headers: { apikey: KEY, Authorization: 'Bearer ' + (token || KEY), ...(isBlob ? {} : { 'Content-Type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : isBlob ? body : JSON.stringify(body),
    });
  } catch (e) {
    throw new ApiError(e.name === 'AbortError' ? 'The server took too long to answer. Please try again.' : 'Cannot reach the server. Please check your internet connection and try again.');
  } finally { clearTimeout(t); }
  let data = null;
  const text = await res.text();
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  if (!res.ok) {
    const msg = (data && (data.message || data.msg || data.error_description || data.error)) || 'Something went wrong. Please try again.';
    throw new ApiError(friendly(String(msg), res.status), { status: res.status, hint: data && data.hint, code: data && (data.code || data.error_code) });
  }
  return data;
}

function friendly(msg, status) {
  if (/permission denied|row-level security|42501/i.test(msg) || status === 403) return 'You are not allowed to do this.';
  if (/jwt expired|invalid jwt/i.test(msg)) return 'Your sign-in has expired. Please sign in again.';
  if (/could not find the function|schema cache/i.test(msg)) return 'The shop database is not fully set up yet (a database function is missing). Please run the setup SQL again.';
  return msg;
}

async function refresh() {
  if (!session || !session.refresh_token) throw new ApiError('Please sign in again.');
  try {
    const d = await raw('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: session.refresh_token } });
    setSession(toSession(d));
  } catch (e) { setSession(null); throw new ApiError('Your sign-in has expired. Please sign in again.', { status: 401 }); }
}
const toSession = (d) => ({
  access_token: d.access_token, refresh_token: d.refresh_token,
  expires_at: d.expires_at ? d.expires_at * 1000 : Date.now() + (d.expires_in || 3600) * 1000,
  email: d.user && d.user.email, id: d.user && d.user.id,
});

async function authed(fn) {
  if (!session) throw new ApiError('Please sign in.', { status: 401 });
  if (session.expires_at - Date.now() < 60000) await refresh();
  try { return await fn(session.access_token); }
  catch (e) {
    if (e.status === 401) { await refresh(); return fn(session.access_token); }
    throw e;
  }
}

/** Public call (customers). */
export const rpc = (fn, args = {}) => raw('/rest/v1/rpc/' + fn, { method: 'POST', body: args });
/** Owner call (needs sign-in; the database re-checks that the user really is the owner). */
export const adminRpc = (fn, args = {}) => authed((token) => raw('/rest/v1/rpc/' + fn, { method: 'POST', body: args, token }));

export async function signIn(email, password) {
  const d = await raw('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } }).catch((e) => {
    if (/invalid login|invalid_grant|invalid credentials/i.test(e.message)) throw new ApiError('Wrong email or password.');
    throw e;
  });
  setSession(toSession(d));
  return session;
}
export async function signOut() {
  const tok = session && session.access_token;
  setSession(null);
  if (tok) { try { await raw('/auth/v1/logout', { method: 'POST', token: tok, body: {} }); } catch { /* already signed out locally */ } }
}

/** Uploads one product photo (owner only; storage policies enforce it). Returns the public URL. */
export async function uploadProductImage(blob, ext) {
  const path = `products/${crypto.randomUUID()}.${ext}`;
  await authed((token) => raw('/storage/v1/object/product-images/' + path, { method: 'POST', body: blob, token, isBlob: true, headers: { 'Content-Type': blob.type, 'x-upsert': 'false' }, timeout: 60000 }));
  return publicImageUrl(path);
}

/** Edge Function "notifications". drain = send whatever is queued (safe for anyone to call). */
export const drainNotifications = () => raw('/functions/v1/notifications', { method: 'POST', body: { action: 'drain' }, timeout: 40000 }).catch(() => null);
export const notifyAdmin = (body) => authed((token) => raw('/functions/v1/notifications', { method: 'POST', body, token, timeout: 40000 }));
