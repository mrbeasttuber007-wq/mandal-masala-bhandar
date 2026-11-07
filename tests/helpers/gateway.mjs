// TEST-ONLY local stand-in for Supabase's web API, wired to the REAL database
// functions and the REAL notifications Edge Function code.
//   /rest/v1/rpc/<fn>     -> database function, run as anon / owner / service role (real permission checks)
//   /auth/v1/token        -> sign-in for test users
//   /storage/v1/object/*  -> product image upload (owner only) + public download
//   /functions/v1/notifications -> the actual Edge Function handler
//   /mock/resend, /mock/whatsapp -> fake providers that record what they receive
// It is NOT used in production.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { rpcAsync } from './pg.js';
import { createHandler } from '../../supabase/functions/notifications/index.ts';

export const SERVICE_KEY = 'test-service-role-key';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.webp': 'image/webp' };

export async function startGateway({ port = 0, staticDir = null, users = {} } = {}) {
  const state = {
    users,                        // email -> { id, password }
    files: new Map(),             // storage objects
    resend: [], whatsapp: [],     // what the fake providers received
    providerMode: { resend: 'ok', whatsapp: 'ok' },   // 'ok' | 'fail500' | 'fail400' | 'timeout'
    env: { RESEND_API_KEY: '', WHATSAPP_TOKEN: '', WHATSAPP_PHONE_NUMBER_ID: '', SITE_URL: 'https://shop.example' },
    log: [],
  };
  let base = '';
  const mkToken = (u) => 'mock.' + Buffer.from(JSON.stringify({ sub: u.id, email: u.email })).toString('base64url');
  const ctxFor = (req) => {
    const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (bearer === SERVICE_KEY) return { role: 'service_role' };
    if (bearer.startsWith('mock.')) {
      try { return { role: 'authenticated', uid: JSON.parse(Buffer.from(bearer.slice(5), 'base64url').toString()).sub }; } catch { /* fallthrough */ }
    }
    return { role: 'anon' };
  };
  const readBody = (req) => new Promise((res) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => res(Buffer.concat(c))); });
  const send = (res, status, body, headers = {}) => {
    const isBuf = Buffer.isBuffer(body);
    res.writeHead(status, { 'Content-Type': isBuf ? 'application/octet-stream' : 'application/json', 'Access-Control-Allow-Origin': '*', ...headers });
    res.end(isBuf ? body : body == null ? '' : JSON.stringify(body));
  };

  const edge = createHandler({
    env: new Proxy({}, { get: (_, k) => ({ SUPABASE_URL: base, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, SUPABASE_ANON_KEY: 'test-anon-key',
      RESEND_API_URL: base + '/mock/resend', WHATSAPP_API_URL: base + '/mock/whatsapp', ...state.env })[k] }),
    fetch: (...a) => fetch(...a),
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    try {
      if (req.method === 'OPTIONS') return send(res, 204, null, { 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' });

      if (p.startsWith('/rest/v1/rpc/')) {
        const fn = p.slice('/rest/v1/rpc/'.length);
        const args = JSON.parse((await readBody(req)).toString() || '{}');
        const ctx = ctxFor(req);
        const r = await rpcAsync(fn, args, ctx);
        state.log.push({ fn, role: ctx.role, ok: r.ok });
        if (r.ok) return send(res, 200, r.data);
        const status = r.code === '42501' ? (ctx.role === 'anon' ? 401 : 403) : r.code === '42883' ? 404 : 400;
        return send(res, status, { code: r.code, message: r.message, details: null, hint: null });
      }

      if (p === '/auth/v1/token') {
        const body = JSON.parse((await readBody(req)).toString() || '{}');
        const grant = url.searchParams.get('grant_type');
        let u;
        if (grant === 'password') { u = state.users[(body.email || '').toLowerCase()]; if (!u || u.password !== body.password) return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials' }); u = { ...u, email: body.email.toLowerCase() }; }
        else if (grant === 'refresh_token') { const e = Object.keys(state.users).find((k) => 'refresh-' + state.users[k].id === body.refresh_token); if (!e) return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' }); u = { ...state.users[e], email: e }; }
        else return send(res, 400, { error: 'unsupported_grant_type' });
        return send(res, 200, { access_token: mkToken(u), token_type: 'bearer', expires_in: 3600, refresh_token: 'refresh-' + u.id, user: { id: u.id, email: u.email } });
      }
      if (p === '/auth/v1/logout') return send(res, 204, null);

      if (p.startsWith('/storage/v1/object/')) {
        if (req.method === 'GET' && p.startsWith('/storage/v1/object/public/')) {
          const key = p.slice('/storage/v1/object/public/'.length); const f = state.files.get(key);
          return f ? send(res, 200, f.data, { 'Content-Type': f.type, 'Cache-Control': 'public, max-age=60' }) : send(res, 404, { message: 'not found' });
        }
        if (req.method === 'POST') {
          const ctx = ctxFor(req);
          const ok = ctx.role === 'authenticated' && (await rpcAsync('is_admin', {}, ctx)).data === true;
          if (!ok) return send(res, 403, { message: 'new row violates row-level security policy' });
          const key = p.slice('/storage/v1/object/'.length); const data = await readBody(req);
          if (data.length > 2097152) return send(res, 413, { message: 'The object exceeded the maximum allowed size' });
          state.files.set(key, { data, type: req.headers['content-type'] || 'application/octet-stream' });
          return send(res, 200, { Key: key });
        }
      }

      if (p === '/functions/v1/notifications') {
        const body = await readBody(req);
        const r = await edge(new Request(base + p, { method: req.method, headers: Object.fromEntries(Object.entries(req.headers).filter(([, v]) => typeof v === 'string')), body: req.method === 'POST' ? body : undefined }));
        return send(res, r.status, JSON.parse((await r.text()) || 'null'));
      }

      if (p === '/mock/resend/emails' || /^\/mock\/whatsapp\/[^/]+\/messages$/.test(p)) {
        const kind = p.includes('resend') ? 'resend' : 'whatsapp';
        const body = JSON.parse((await readBody(req)).toString() || '{}');
        state[kind].push({ auth: req.headers.authorization, body });
        const mode = state.providerMode[kind];
        if (mode === 'fail500') return send(res, 503, kind === 'resend' ? { message: 'upstream down' } : { error: { message: 'Service unavailable', code: 2 } });
        if (mode === 'fail400') return send(res, 400, kind === 'resend' ? { message: 'Invalid `to` field' } : { error: { message: 'Recipient phone number not in allowed list', code: 131030 } });
        return send(res, 200, kind === 'resend' ? { id: 'resend-' + state.resend.length } : { messaging_product: 'whatsapp', messages: [{ id: 'wamid.' + state.whatsapp.length }] });
      }

      if (p === '/__control') {   // test hooks
        const body = JSON.parse((await readBody(req)).toString() || '{}');
        if (body.providerMode) Object.assign(state.providerMode, body.providerMode);
        if (body.env) Object.assign(state.env, body.env);
        if (body.reset) { state.resend.length = 0; state.whatsapp.length = 0; }
        return send(res, 200, { resend: state.resend, whatsapp: state.whatsapp });
      }

      if (staticDir && req.method === 'GET') {   // the website itself
        let f = path.join(staticDir, p === '/' ? 'index.html' : p);
        if (!f.startsWith(staticDir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(staticDir, 'index.html');
        res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
        return res.end(fs.readFileSync(f));
      }
      send(res, 404, { message: 'not found' });
    } catch (e) { send(res, 500, { message: String(e) }); }
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  return { url: base, state, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}
