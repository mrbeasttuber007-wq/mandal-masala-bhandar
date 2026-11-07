// Local development server:  npm run dev   ->  http://localhost:5173
import esbuild from 'esbuild';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { root, loadEnv, checkKeys, options, finish } from './build.mjs';

const env = loadEnv();
const problems = checkKeys(env);
if (problems.length) { console.error('\n - ' + problems.join('\n - ')); process.exit(1); }
const outdir = path.join(root, 'dist-dev');
fs.rmSync(outdir, { recursive: true, force: true });
const ctx = await esbuild.context({
  ...options(env, outdir), sourcemap: true,
  plugins: [{ name: 'html', setup(b) { b.onEnd((r) => { if (r.metafile) finish(r, outdir); }); } }],
});
await ctx.watch();
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.map': 'application/json' };
http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let f = path.join(outdir, p);
  if (!f.startsWith(outdir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(outdir, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  res.end(fs.readFileSync(f));
}).listen(5173, () => console.log('Dev server: http://localhost:5173'));
