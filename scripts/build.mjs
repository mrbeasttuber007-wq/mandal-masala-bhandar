// Builds the website into ./dist  (run with: npm run build)
// Uses esbuild (the same fast engine Vite uses inside). No secret is ever read here:
// only the two PUBLIC values VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are put into the site.
import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadEnv() {
  const env = {};
  const file = path.join(root, '.env');
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !line.trim().startsWith('#')) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  for (const k of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']) if (process.env[k]) env[k] = process.env[k];
  return env;
}

/** Stops the build if someone pasted a SECRET key where the public key belongs. */
export function checkKeys(env) {
  const url = env.VITE_SUPABASE_URL || '';
  const key = env.VITE_SUPABASE_ANON_KEY || '';
  const problems = [];
  if (/^sb_secret_/i.test(key)) problems.push('VITE_SUPABASE_ANON_KEY is a SECRET key (sb_secret_...). Use the publishable / anon key instead.');
  try {
    const part = key.split('.')[1];
    if (part) {
      const role = JSON.parse(Buffer.from(part, 'base64url').toString()).role;
      if (role === 'service_role') problems.push('VITE_SUPABASE_ANON_KEY is the service_role key. That key must NEVER go in the website. Use the anon / publishable key.');
    }
  } catch { /* not a JWT: fine (new-style publishable keys are not JWTs) */ }
  if (url && !/^https?:\/\//.test(url)) problems.push('VITE_SUPABASE_URL must start with https://');
  return problems;
}

export function options(env, outdir = path.join(root, 'dist')) {
  return {
    entryPoints: [path.join(root, 'src/main.jsx')],
    bundle: true, splitting: true, format: 'esm', target: ['es2020'],
    outdir: path.join(outdir, 'assets'), entryNames: '[name]-[hash]', chunkNames: 'chunk-[name]-[hash]', assetNames: '[name]-[hash]',
    jsx: 'automatic', loader: { '.jsx': 'jsx', '.js': 'jsx', '.svg': 'dataurl' },
    metafile: true, legalComments: 'none',
    define: {
      'process.env.NODE_ENV': '"production"',
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(env.VITE_SUPABASE_URL || ''),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(env.VITE_SUPABASE_ANON_KEY || ''),
    },
  };
}

export function finish(result, outdir = path.join(root, 'dist')) {
  fs.mkdirSync(outdir, { recursive: true });
  fs.cpSync(path.join(root, 'public'), outdir, { recursive: true });
  const out = Object.keys(result.metafile.outputs).map((f) => path.relative(outdir, path.resolve(root, f)).replace(/\\/g, '/'));
  const js = out.find((f) => /assets\/main-.*\.js$/.test(f));
  const css = out.find((f) => /assets\/main-.*\.css$/.test(f));
  let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  html = html.replace('<script type="module" src="/src/main.jsx"></script>',
    (css ? `<link rel="stylesheet" href="/${css}" />\n    ` : '') + `<script type="module" src="/${js}"></script>`);
  fs.writeFileSync(path.join(outdir, 'index.html'), html);
  return { js, css, files: out };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const env = loadEnv();
  const problems = checkKeys(env);
  if (problems.length) { console.error('\nBUILD STOPPED:\n - ' + problems.join('\n - ') + '\n'); process.exit(1); }
  if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) {
    console.warn('\nWARNING: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set. The site will build but will show a "setup needed" screen.\n');
  }
  const outdir = process.env.BUILD_OUT ? path.resolve(process.env.BUILD_OUT) : path.join(root, 'dist');
  fs.rmSync(outdir, { recursive: true, force: true });
  const result = await esbuild.build({ ...options(env, outdir), minify: true, sourcemap: false });
  const r = finish(result, outdir);
  const kb = (f) => (fs.statSync(path.join(outdir, f)).size / 1024).toFixed(1) + ' KB';
  console.log('Built OK ->', path.relative(root, outdir) || '.');
  for (const f of r.files.filter((x) => !x.endsWith('.map'))) console.log('  ', f.padEnd(44), kb(f));
}
