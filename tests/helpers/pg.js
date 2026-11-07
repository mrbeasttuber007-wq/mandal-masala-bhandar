// Talks to a local test PostgreSQL through the psql command line.
// TEST HELPER ONLY (not part of the website).
import { spawnSync } from 'node:child_process';

const port = process.env.PGPORT || '54329';
export const DB = process.env.PGDB || 'mmb_test';

export class PgError extends Error {
  constructor(message, code, hint) { super(message); this.code = code; this.hint = hint; }
}

const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** Run SQL as a given role (postgres = owner, anon, authenticated, service_role). */
export function sql(text, { role = 'postgres', uid = null, db = DB } = {}) {
  let pre = '\\set VERBOSITY verbose\n';
  if (role !== 'postgres') {
    pre += `set role ${role};\nset request.jwt.claim.sub = ${lit(uid || '')};\n`;
  }
  const r = spawnSync('psql', ['-h', '/tmp', '-p', port, '-U', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-d', db],
    { input: pre + text + '\n', encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    const err = (r.stderr || '').split('\n');
    const first = err.find((l) => l.includes('ERROR:')) || '';
    const m = first.match(/ERROR:\s+([0-9A-Z]{5}):\s*(.*)$/);
    const hint = (err.find((l) => l.startsWith('HINT:')) || '').replace(/^HINT:\s+/, '') || null;
    throw new PgError(m ? m[2] : (r.stderr || 'psql failed'), m ? m[1] : 'XX000', hint);
  }
  return r.stdout.trim();
}

/** Call a database function the way the website does (JSON in, JSON out). */
export function rpc(fn, args = {}, ctx = {}) {
  const out = sql(`select testgw.rpc(${lit(fn)}, ${lit(JSON.stringify(args))}::jsonb)::text;`, ctx);
  return out ? JSON.parse(out) : null;
}

export function query(text, ctx = {}) { return sql(text, ctx); }
export function q1(text, ctx = {}) { const v = sql(text, ctx); return v; }
export { lit };

import { spawn } from 'node:child_process';
/** Same as rpc() but does not block, so two customers can order at the same instant. */
export function rpcAsync(fn, args = {}, { role = 'postgres', uid = null, db = DB } = {}) {
  let pre = '\\set VERBOSITY verbose\n';
  if (role !== 'postgres') pre += `set role ${role};\nset request.jwt.claim.sub = ${lit(uid || '')};\n`;
  const input = pre + `select testgw.rpc(${lit(fn)}, ${lit(JSON.stringify(args))}::jsonb)::text;\n`;
  return new Promise((resolve) => {
    const c = spawn('psql', ['-h', '/tmp', '-p', port, '-U', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-d', db]);
    let out = '', err = '';
    c.stdout.on('data', (d) => (out += d)); c.stderr.on('data', (d) => (err += d));
    c.on('close', (code) => {
      if (code === 0) return resolve({ ok: true, data: out.trim() ? JSON.parse(out) : null });
      const first = err.split('\n').find((l) => l.includes('ERROR:')) || '';
      const m = first.match(/ERROR:\s+([0-9A-Z]{5}):\s*(.*)$/);
      resolve({ ok: false, message: m ? m[2] : err, code: m ? m[1] : 'XX000' });
    });
    c.stdin.end(input);
  });
}
