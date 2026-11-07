// End-to-end test: a real Chromium browser (phone-sized) uses the REAL built website against the REAL database
// functions and the REAL notification Edge Function code, through a local stand-in for Supabase's web API.
// Run: bash tests/db/reset.sh mmb_e2e && PGDB=mmb_e2e node tests/e2e/e2e.mjs
import { chromium } from 'playwright';
import sharp from 'sharp';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { startGateway } from '../helpers/gateway.mjs';
import { sql, rpc as rawRpc } from '../helpers/pg.js';

const PORT = 54380, BASE = `http://127.0.0.1:${PORT}`;
const OWNER = '11111111-1111-4111-8111-111111111111', STRANGER = '22222222-2222-4222-8222-222222222222';
const out = path.join(os.tmpdir(), 'mmb-e2e-dist');
const shots = process.env.SHOTS || path.join(os.tmpdir(), 'mmb-shots'); fs.mkdirSync(shots, { recursive: true });

const b = spawnSync('node', ['scripts/build.mjs'], { env: { ...process.env, BUILD_OUT: out, VITE_SUPABASE_URL: BASE, VITE_SUPABASE_ANON_KEY: 'test-anon-key-1234567890' }, encoding: 'utf8' });
if (b.status !== 0) { console.error(b.stdout, b.stderr); process.exit(1); }

sql(`insert into auth.users (id,email) values ('${OWNER}','owner@example.com'),('${STRANGER}','stranger@example.com') on conflict do nothing`);
sql(`insert into profiles (id, full_name, role) values ('${OWNER}','Owner','owner') on conflict do nothing`);
const gw = await startGateway({ port: PORT, staticDir: out, users: { 'owner@example.com': { id: OWNER, password: 'owner-pass-1' }, 'stranger@example.com': { id: STRANGER, password: 'stranger-pass' } } });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 393, height: 851 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36', acceptDownloads: true });
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push('PAGE ERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push('CONSOLE: ' + m.text()); });
page.on('requestfailed', (r) => { if (!/fonts\.(googleapis|gstatic)/.test(r.url())) problems.push('REQUEST FAILED: ' + r.url()); });

const results = [];
async function step(name, fn) {
  try { await fn(); results.push(['PASS', name]); console.log('PASS', name); }
  catch (e) { results.push(['FAIL', name, e.message]); console.log('FAIL', name, '\n   ', String(e.message).split('\n').slice(0, 6).join('\n    ')); await page.screenshot({ path: path.join(shots, 'FAIL-' + results.length + '.png') }).catch(() => {}); }
}
const go = (p) => page.goto(BASE + p, { waitUntil: 'networkidle' });
const shot = (n) => page.screenshot({ path: path.join(shots, n + '.png') });
const toastText = async () => (await page.locator('.toast').allTextContents()).join(' | ');
const q = (s) => sql(s);

// ---------------------------------------------------------------- 1. the empty shop
await step('1. Customer opens the website (no products yet: friendly empty state, no fake data)', async () => {
  await go('/');
  await page.getByRole('heading', { name: /Fresh spices/ }).waitFor();
  await page.getByText('Our shelves are being stocked').waitFor();
  for (const c of ['Whole Spices', 'Ground Spices', 'Masala Blends', 'Dry Fruits']) await page.locator('.cat-tile', { hasText: c }).waitFor();
  await shot('01-home-empty');
});

// ---------------------------------------------------------------- 2. admin security
await step('2a. Unauthorized: /admin shows a sign-in form, no data', async () => {
  await go('/admin');
  await page.getByRole('heading', { name: 'Shop owner sign in' }).waitFor();
  assert.equal(await page.getByText('Recent orders').count(), 0);
});
await step('2b. Unauthorized: anonymous API calls to admin functions are refused', async () => {
  const r = await page.evaluate(async (base) => {
    const o = {};
    for (const fn of ['admin_list_orders', 'admin_dashboard', 'admin_list_products', 'admin_get_settings']) {
      const res = await fetch(base + '/rest/v1/rpc/' + fn, { method: 'POST', headers: { 'content-type': 'application/json', apikey: 'x', authorization: 'Bearer test-anon-key-1234567890' }, body: '{}' });
      o[fn] = res.status;
    } return o;
  }, BASE);
  for (const [fn, s] of Object.entries(r)) assert.ok(s === 401 || s === 403, fn + ' returned ' + s);
});
await step('2c. Wrong password is refused with a clear message', async () => {
  await page.getByLabel('Email').fill('owner@example.com'); await page.getByLabel('Password').fill('nope');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByText('Wrong email or password.').waitFor();
});
await step('2d. A signed-in stranger (not the owner) cannot use the panel', async () => {
  await page.getByLabel('Email').fill('stranger@example.com'); await page.getByLabel('Password').fill('stranger-pass');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByText('This account is not the shop owner').waitFor();
  const r = await page.evaluate(async (base) => { const s = JSON.parse(localStorage.getItem('mmb.session.v1') || 'null'); const res = await fetch(base + '/rest/v1/rpc/admin_list_orders', { method: 'POST', headers: { 'content-type': 'application/json', apikey: 'x', authorization: 'Bearer ' + (s && s.access_token) }, body: '{}' }); return res.status; }, BASE);
  assert.ok(r === 401 || r === 403, 'stranger got ' + r);
  await page.getByRole('button', { name: 'Sign out' }).click();
});
await step('2e. The owner signs in', async () => {
  await page.getByLabel('Email').fill('owner@example.com'); await page.getByLabel('Password').fill('owner-pass-1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('heading', { name: 'Dashboard' }).waitFor();
  await page.getByText('No orders yet').waitFor();
  await shot('02-admin-dashboard-empty');
});

// ---------------------------------------------------------------- 3. owner sets up the shop
await step('3a. Owner adds a delivery area (nothing is pre-filled)', async () => {
  await go('/admin/delivery');
  await page.getByText('No delivery areas yet').first().waitFor();
  await page.getByRole('button', { name: '+ Add delivery area' }).first().click();
  await page.getByLabel('Area name *').fill('Beldanga Town');
  await page.getByLabel('PIN codes *').fill('742175, 742189');
  await page.getByLabel('Delivery charge (Rs.)').fill('40');
  await page.getByLabel('Minimum order value (Rs., optional)').fill('100');
  await page.getByLabel('Free delivery above (Rs., optional)').fill('600');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('cell', { name: 'Beldanga Town' }).waitFor();
  await shot('03-admin-delivery');
});
await step('3b. Owner edits shop contact details', async () => {
  await go('/admin/settings');
  await page.getByLabel('Phone number shown to customers').fill('+91 98000 11122');
  await page.getByLabel('WhatsApp number for customers (optional)').fill('9800011122');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await page.getByText('Settings saved').waitFor();
});

const png = path.join(os.tmpdir(), 'turmeric.png');
await sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#E8A00C' } }).composite([{ input: Buffer.from(Array.from({ length: 1600 * 1200 * 3 }, () => Math.random() * 255 | 0)), raw: { width: 1600, height: 1200, channels: 3 }, blend: 'over' }]).png().toFile(png);
console.log('   test photo size:', (fs.statSync(png).size / 1048576).toFixed(1), 'MB');

async function addProduct({ name, category, short, long, sizes, featured, best, photo }) {
  await go('/admin/products/new');
  await page.getByLabel('Product name *').fill(name);
  await page.getByLabel('Category *').selectOption({ label: category });
  await page.getByLabel('Short description').fill(short);
  await page.getByLabel('Full description').fill(long);
  if (photo) { await page.locator('input[type=file]').setInputFiles(png); await page.getByText('Photo uploaded').waitFor(); }
  if (featured) await page.getByLabel('Featured on home page').check({ force: true });
  if (best) await page.getByLabel('Best seller').check({ force: true });
  for (const [i, s] of sizes.entries()) {
    await page.getByRole('button', { name: s.label === 'custom' ? '+ Other size' : '+ ' + s.label }).click();
    const row = page.locator('.variant-row').nth(i);
    if (s.label === 'custom') await row.getByLabel('Pack size').fill(s.custom);
    await row.getByLabel('Price (Rs.)').fill(String(s.price));
    if (s.old) await row.getByLabel('Old price (optional)').fill(String(s.old));
    await row.getByLabel('Stock').fill(String(s.stock));
  }
  await page.getByRole('button', { name: 'Save product' }).click();
  await page.getByText('Product saved').waitFor();
  await page.getByRole('heading', { name: 'Products' }).waitFor();
}
await step('3c. Owner adds products with photo upload and several pack sizes', async () => {
  await addProduct({ name: 'Turmeric Powder', category: 'Ground Spices', short: 'Pure ground haldi', long: 'Bright, aromatic turmeric powder.', featured: true, best: true, photo: true,
    sizes: [{ label: '100g', price: 40, stock: 20 }, { label: '250g', price: 90, old: 110, stock: 10 }, { label: '1kg', price: 330, stock: 0 }] });
  await addProduct({ name: 'Whole Cumin (Jeera)', category: 'Whole Spices', short: 'Cleaned whole cumin seeds', long: 'Whole jeera.', featured: true,
    sizes: [{ label: '100g', price: 60, stock: 5 }, { label: '500g', price: 270, stock: 8 }] });
  await addProduct({ name: 'Almonds (Badam)', category: 'Dry Fruits', short: 'Premium California almonds', long: 'Crunchy almonds.', best: true,
    sizes: [{ label: '250g', price: 260, stock: 12 }, { label: '500g', price: 500, stock: 3 }] });
  const n = Number(q(`select count(*) from products`)), v = Number(q(`select count(*) from product_variants`));
  assert.equal(n, 3); assert.equal(v, 7);
  const img = q(`select image_url from products where name='Turmeric Powder'`);
  assert.match(img, /\/storage\/v1\/object\/public\/product-images\/products\/.+\.jpg$/);
  const stored = [...gw.state.files.values()][0];
  assert.ok(stored.data.length < 2097152, 'photo was shrunk below 2 MB: ' + stored.data.length);
  await shot('04-admin-products');
});
await step('3d. Product list shows pack sizes with separate prices and stock', async () => {
  await go('/admin/products');
  await page.getByText('250g ₹90').first().waitFor();
  await page.getByText('1kg ₹330').first().waitFor();
});

// ---------------------------------------------------------------- 4. customer journey
await step('4a. Home page shows featured, best sellers, offers and delivery areas', async () => {
  await go('/');
  await page.getByRole('heading', { name: 'Featured products' }).waitFor();
  await page.getByRole('heading', { name: 'Best sellers' }).waitFor();
  await page.getByRole('heading', { name: 'Special offers' }).waitFor();
  await page.getByText('Beldanga Town').first().waitFor();
  await page.locator('.pcard img').first().waitFor();
  await shot('05-home');
});
await step('4b. Shop: search, category filter, sorting, in-stock filter', async () => {
  await go('/shop');
  assert.equal(await page.locator('.pcard').count(), 3);
  await page.getByLabel('Search products').fill('cumin');
  await page.waitForFunction(() => document.querySelectorAll('.pcard').length === 1);
  await page.getByLabel('Search products').fill('zzzz');
  await page.getByText('No products found').waitFor();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.pcard').length === 3);
  await page.getByRole('tab', { name: 'Dry Fruits' }).click().catch(() => page.getByRole('button', { name: 'Dry Fruits' }).click());
  await page.waitForFunction(() => document.querySelectorAll('.pcard').length === 1);
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await page.getByLabel('Sort products').selectOption('price-desc');
  const names = await page.locator('.pname').allTextContents();
  assert.equal(names[0], 'Almonds (Badam)');
  await page.getByLabel('Sort products').selectOption('price-asc');
  assert.equal((await page.locator('.pname').allTextContents())[0], 'Turmeric Powder');
  await shot('06-shop');
});
await step('4c. Product page: pick pack size, out-of-stock size cannot be added', async () => {
  await go('/product/turmeric-powder');
  await page.getByRole('heading', { name: 'Turmeric Powder' }).waitFor();
  await page.getByRole('radio', { name: '1kg' }).click();
  await page.getByText('Out of stock', { exact: true }).first().waitFor();
  assert.ok(await page.getByRole('button', { name: 'Out of stock' }).isDisabled());
  await page.getByRole('radio', { name: '250g' }).click();
  await page.getByText('₹110').waitFor();           // crossed-out price
  await page.getByText(/% off/).waitFor();
  await shot('07-product');
});
await step('4d. Add to cart (several products, sizes, quantities)', async () => {
  await page.getByRole('button', { name: 'More' }).click();           // qty 2
  await page.getByRole('button', { name: 'Add to cart' }).click();               // Turmeric 250g x2 = 180
  await page.getByText('Added Turmeric Powder (250g)').waitFor();
  await go('/product/almonds-badam');
  await page.getByRole('radio', { name: '500g' }).click();
  await page.getByRole('button', { name: 'Add to cart' }).click();               // Almonds 500g x1 = 500
  await go('/shop?cat=whole-spices');
  await page.getByRole('button', { name: 'Add to cart' }).click();               // Cumin 100g x1 = 60
  assert.match(await page.locator('.cart-btn').getAttribute('aria-label'), /4 items/);
});
await step('4e. Cart persists after refresh and shows subtotal, delivery and final amount', async () => {
  await go('/cart');
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.locator('.cart-line').count(), 3);
  await page.getByText('₹740', { exact: true }).first().waitFor();    // 180 + 500 + 60
  await page.getByLabel('Delivery PIN code').fill('999999');
  await page.getByText('Sorry, we do not deliver to PIN code 999999 yet.').waitFor();
  assert.ok(await page.getByRole('button', { name: 'Proceed to checkout' }).isDisabled());
  await page.getByLabel('Delivery PIN code').fill('742175');
  await page.getByText('We deliver to Beldanga Town').waitFor();
  await page.getByText('Free', { exact: true }).first().waitFor();     // 740 >= 600 free delivery
  await shot('08-cart');
});
await step('4f. Cart: change quantity, change pack size, remove item; delivery charge recalculates', async () => {
  const cumin = page.locator('.cart-line', { hasText: 'Whole Cumin' });
  await cumin.getByRole('button', { name: 'More' }).click();           // 2 x 60 = 120
  await cumin.getByLabel(/Pack size for Whole Cumin/).selectOption({ label: '500g - ₹270' });
  await page.getByText('₹1,220', { exact: true }).first().waitFor();   // 180 + 500 + 270 x2 ... qty carried = 2 -> 540
  await page.locator('.cart-line', { hasText: 'Almonds' }).getByRole('button', { name: /Remove/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('.cart-line').length === 2);
  await page.getByText('₹720', { exact: true }).first().waitFor();     // 180 + 540
  await page.locator('.cart-line', { hasText: 'Whole Cumin' }).getByRole('button', { name: 'Fewer' }).click();   // 1 x 270
  await page.getByText('₹450', { exact: true }).first().waitFor();     // 180 + 270 = 450 < 600 -> delivery 40
  await page.getByText('₹490', { exact: true }).first().waitFor();     // total 490
  await page.getByText(/Free delivery on orders of ₹600/).waitFor();
});
await step('4g. Checkout: missing / invalid details are refused with clear messages', async () => {
  await page.getByRole('link', { name: 'Proceed to checkout' }).click();
  await page.getByRole('heading', { name: 'Checkout' }).waitFor();
  await page.getByRole('button', { name: /Place order/ }).click();
  for (const m of ['Please enter your full name.', 'Enter a valid 10-digit Indian mobile number.', 'Please enter your full delivery address', 'Please enter your locality or area.', 'Please enter your city or town.']) await page.getByText(m).first().waitFor();
  await page.getByLabel('Full name *').fill('Rina Das');
  await page.getByLabel('Mobile number *').fill('12345');
  await page.getByLabel('Full address *').fill('Ward 3, near the temple, Kalitala');
  await page.getByLabel('Locality / area *').fill('Kalitala'); await page.getByLabel('City / town *').fill('Beldanga');
  await page.getByRole('button', { name: /Place order/ }).click();
  await page.getByText('Enter a valid 10-digit Indian mobile number.').first().waitFor();
  assert.equal(Number(q(`select count(*) from orders`)), 0);
  await page.getByLabel('Mobile number *').fill('0000000000');
  await page.getByRole('button', { name: /Place order/ }).click();
  await page.getByText('Enter a valid 10-digit Indian mobile number.').first().waitFor();
  await page.getByLabel('PIN code *').fill('742000');
  await page.getByText('Sorry, we do not deliver to PIN code 742000 yet.').first().waitFor();
  await page.getByRole('button', { name: /Place order/ }).click();
  assert.equal(Number(q(`select count(*) from orders`)), 0);
  await shot('09-checkout-errors');
});
let orderCode, orderPhone = '9830012345';
await step('4h. Checkout: review shows names, sizes, quantities, prices, delivery and final amount', async () => {
  await page.getByLabel('Mobile number *').fill('+91 98300 12345');
  await page.getByLabel('PIN code *').fill('742175');
  await page.getByLabel('Email (optional)').fill('rina@example.com');
  await page.getByLabel('Order notes (optional)').fill('Please call at the gate');
  await page.getByText('We deliver to Beldanga Town').first().waitFor();
  const sum = await page.locator('.summary').innerText();
  for (const t of ['Turmeric Powder', '(250g)', '₹90 × 2', 'Whole Cumin (Jeera)', '(500g)', '₹270 × 1', '₹450', '₹40', '₹490']) assert.ok(sum.includes(t), 'summary has ' + t + '\n' + sum);
  await shot('10-checkout');
});
await step('4i. Browser tampering: a wrong total / fake prices cannot change what is charged', async () => {
  const vid = q(`select id from product_variants where label='250g' and product_id=(select id from products where name='Turmeric Powder')`);
  const r = await page.evaluate(async ({ base, vid }) => {
    const call = (extra, qty = 1) => fetch(base + '/rest/v1/rpc/place_order', { method: 'POST', headers: { 'content-type': 'application/json', apikey: 'x', authorization: 'Bearer test-anon-key-1234567890' }, body: JSON.stringify({ p: { idempotency_key: crypto.randomUUID(), customer: { name: 'Hacker', phone: '9876543210', address: '1 Test Street, Beldanga', locality: 'Town', city: 'Beldanga', state: 'West Bengal', pin: '742175' }, items: [{ variant_id: vid, quantity: qty, price: 1, unit_price: 1 }], ...extra } }) }).then(async (x) => ({ s: x.status, j: await x.json() }));
    return { wrongTotal: await call({ expected_total: 1 }, 2), fakePrice: await call({}, 1) };
  }, { base: BASE, vid });
  assert.equal(r.wrongTotal.s, 400); assert.match(r.wrongTotal.j.message, /Prices or delivery charges have changed/);
  assert.equal(r.fakePrice.s, 400);   // total 90 < minimum order 100 so refused, never charged Rs.1
  assert.match(r.fakePrice.j.message, /minimum order/i);
  assert.equal(Number(q(`select count(*) from orders`)), 0);
});
await step('4j. Customer places the COD order; a double tap creates only ONE order', async () => {
  const btn = page.getByRole('button', { name: /Place order/ });
  await btn.dblclick();
  await page.getByRole('heading', { name: /Thank you, Rina/ }).waitFor();
  orderCode = (await page.locator('.order-id strong').innerText()).trim();
  assert.match(orderCode, /^MMB-[A-Z2-9]{8}$/);
  assert.equal(Number(q(`select count(*) from orders`)), 1);
  const o = JSON.parse(q(`select row_to_json(o) from orders o`));
  assert.equal(o.status, 'pending'); assert.equal(Number(o.total), 490); assert.equal(Number(o.delivery_charge), 40); assert.equal(o.payment_method, 'cod'); assert.equal(o.customer_phone, orderPhone);
  assert.equal(Number(q(`select count(*) from order_items`)), 2);
  await page.getByText('Pay on delivery').waitFor();
  await page.getByRole('link', { name: 'Send order on WhatsApp' }).waitFor();
  assert.match(await page.getByRole('link', { name: 'Send order on WhatsApp' }).getAttribute('href'), /^https:\/\/wa\.me\/919800011122\?text=/);
  await shot('11-order-success');
});
await step('4k. Stock was reduced correctly and the cart was emptied', async () => {
  assert.equal(q(`select stock_qty from product_variants where label='250g' and product_id=(select id from products where name='Turmeric Powder')`), '8');
  assert.equal(q(`select stock_qty from product_variants where label='500g' and product_id=(select id from products where name like 'Whole Cumin%')`), '7');
  assert.equal(q(`select stock_qty from product_variants where label='500g' and product_id=(select id from products where name like 'Almonds%')`), '3');
  await go('/cart'); await page.getByText('Your cart is empty').waitFor();
});
await step('4l. Order is saved even though no email / WhatsApp is configured (messages marked skipped)', async () => {
  const rows = q(`select channel||'/'||recipient_type||'='||status from notification_logs order by 1`).split('\n');
  assert.deepEqual(rows.sort(), ['email/customer=skipped', 'email/owner=skipped', 'whatsapp/customer=skipped', 'whatsapp/owner=skipped']);
});

// ---------------------------------------------------------------- 5. out of stock / concurrency from the UI
await step('5. Out-of-stock: customer cannot order more than the stock; nothing saved', async () => {
  // Almonds 500g has stock 3.
  await go('/product/almonds-badam'); await page.getByRole('radio', { name: '500g' }).click();
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'More' }).click();   // qty 5
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await go('/checkout');
  await page.getByLabel('Full name *').fill('Rina Das'); await page.getByLabel('Mobile number *').fill('9830012345');
  await page.getByLabel('Full address *').fill('Ward 3, near the temple'); await page.getByLabel('Locality / area *').fill('Kalitala'); await page.getByLabel('City / town *').fill('Beldanga'); await page.getByLabel('PIN code *').fill('742175');
  await page.getByText('We deliver to').first().waitFor();
  await page.getByRole('button', { name: /Place order/ }).click();
  await page.getByText(/Only 3 of Almonds \(Badam\) \(500g\) left in stock/).waitFor();
  assert.equal(Number(q(`select count(*) from orders`)), 1);
  assert.equal(q(`select stock_qty from product_variants where label='500g' and product_id=(select id from products where name like 'Almonds%')`), '3');
  await shot('12-out-of-stock-error');
});

// ---------------------------------------------------------------- 6. tracking
await step('6a. Tracking: a guessed order ID without the right mobile number shows nothing', async () => {
  await go('/track');
  await page.getByLabel('Order ID').fill(orderCode); await page.getByLabel('Mobile number used at checkout').fill('9999999999');
  await page.getByRole('button', { name: 'Track order' }).click();
  await page.getByText('We could not find an order with that ID and mobile number').waitFor();
  assert.equal(await page.getByText('Rina Das').count(), 0);
  await page.getByLabel('Order ID').fill(orderCode); await page.getByLabel('Mobile number used at checkout').fill('');
  await page.getByRole('button', { name: 'Track order' }).click();
  await page.getByText('Please enter the 10-digit mobile number').waitFor();
});
await step('6b. Tracking with the right ID + mobile shows status, items and history', async () => {
  await page.getByLabel('Mobile number used at checkout').fill('98300 12345');
  await page.getByRole('button', { name: 'Track order' }).click();
  await page.locator('.timeline').waitFor();
  await page.getByText('Turmeric Powder').waitFor(); await page.getByText('₹490').first().waitFor();
  assert.equal(await page.locator('.timeline li.done').count(), 1);
  await shot('13-track');
});

// ---------------------------------------------------------------- 7. owner handles the order
await step('7a. Owner signs in and sees the new order on the dashboard', async () => {
  await go('/admin');
  await page.getByRole('heading', { name: 'Dashboard' }).waitFor();
  await page.locator('.stat', { hasText: 'Pending orders' }).getByText('1', { exact: true }).waitFor();
  await page.locator('.list').getByText(orderCode).waitFor();
  await page.getByText('Low stock').first().waitFor();
  await shot('14-admin-dashboard');
});
await step('7b. Orders list: search, status filter, date filter', async () => {
  await page.getByRole('link', { name: 'Orders' }).first().evaluate((a) => a.click());
  await page.getByRole('heading', { name: 'Orders' }).waitFor();
  await page.getByPlaceholder('Order ID, name or mobile').fill('9830012345');
  await page.getByRole('link', { name: orderCode }).waitFor();
  await page.getByPlaceholder('Order ID, name or mobile').fill('nobody');
  await page.getByText('No orders found').waitFor();
  await page.getByRole('button', { name: 'Clear' }).click();
  await page.getByLabel('Status').selectOption('delivered'); await page.getByText('No orders found').waitFor();
  await page.getByLabel('Status').selectOption('pending'); await page.getByRole('link', { name: orderCode }).waitFor();
  await page.getByLabel('Status').selectOption('');
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  await page.getByLabel('From date').fill(today); await page.getByLabel('To date').fill(today); await page.getByRole('link', { name: orderCode }).waitFor();
  await page.getByLabel('From date').fill('2020-01-01'); await page.getByLabel('To date').fill('2020-01-02'); await page.getByText('No orders found').waitFor();
  await page.getByRole('button', { name: 'Clear' }).click();
});
await step('7c. Owner opens the order: full customer + order details, manual WhatsApp link', async () => {
  await page.getByRole('link', { name: orderCode }).click();
  await page.getByRole('heading', { name: 'Order details' }).waitFor();
  for (const t of ['Rina Das', '9830012345', 'rina@example.com', 'Ward 3, near the temple, Kalitala', 'Please call at the gate', 'Turmeric Powder', 'Whole Cumin (Jeera)', '₹490']) await page.getByText(t).first().waitFor();
  const href = await page.getByRole('link', { name: 'Message customer' }).getAttribute('href');
  assert.match(href, /^https:\/\/wa\.me\/919830012345\?text=/);
  assert.ok(decodeURIComponent(href).includes(orderCode));
  await shot('15-admin-order');
});
await step('7d. Owner confirms, then moves the order through every status; history has timestamps', async () => {
  await page.getByRole('button', { name: 'Mark Confirmed' }).click(); await page.getByText('Order marked Confirmed').waitFor();
  await page.getByRole('button', { name: 'Mark Processing' }).click(); await page.getByText('Order marked Processing').waitFor();
  await page.getByRole('button', { name: 'Mark Out for Delivery' }).click(); await page.getByText('Order marked Out for Delivery').waitFor();
  await page.getByRole('button', { name: 'Mark Delivered' }).click(); await page.getByText('Order marked Delivered').waitFor();
  await page.getByRole('button', { name: 'Cancel order' }).waitFor({ state: 'detached' });
  assert.equal(q(`select status from orders where order_code='${orderCode}'`), 'delivered');
  assert.equal(Number(q(`select count(*) from order_status_history h join orders o on o.id=h.order_id where o.order_code='${orderCode}' and changed_at is not null`)), 5);
});
await step('7e. Customer now tracks the delivered order', async () => {
  await go('/track?code=' + orderCode);
  await page.getByLabel('Mobile number used at checkout').fill('9830012345');
  await page.getByRole('button', { name: 'Track order' }).click();
  await page.locator('.timeline').waitFor();
  assert.equal(await page.locator('.timeline li.done').count(), 5);
  await page.locator('.order-id .badge-delivered').waitFor();
});
await step('7f. Cancelled order: stock is restored exactly once', async () => {
  // place a second order directly through the real API (as a customer would)
  const vid = q(`select id from product_variants where label='100g' and product_id=(select id from products where name='Turmeric Powder')`);
  const before = q(`select stock_qty from product_variants where id='${vid}'`);
  const o = await page.evaluate(async ({ base, vid }) => (await fetch(base + '/rest/v1/rpc/place_order', { method: 'POST', headers: { 'content-type': 'application/json', apikey: 'x', authorization: 'Bearer test-anon-key-1234567890' }, body: JSON.stringify({ p: { idempotency_key: crypto.randomUUID(), customer: { name: 'Amit Roy', phone: '9811122233', address: 'Main Road, Beldanga', locality: 'Kalitala', city: 'Beldanga', state: 'West Bengal', pin: '742189' }, items: [{ variant_id: vid, quantity: 3 }] } }) })).json(), { base: BASE, vid });
  assert.equal(o.total, 160);   // 120 + 40
  assert.equal(q(`select stock_qty from product_variants where id='${vid}'`), String(Number(before) - 3));
  await go('/admin/orders'); await page.getByRole('link', { name: o.order_code }).click();
  page.once('dialog', (d) => d.accept());
  await page.getByLabel(/Note/).fill('Customer called to cancel');
  await page.getByRole('button', { name: 'Cancel order' }).click();
  await page.getByText('Order marked Cancelled').waitFor();
  assert.equal(q(`select stock_qty from product_variants where id='${vid}'`), before);
  assert.equal(await page.getByText('Customer called to cancel').count() > 0, true);
  await page.getByText('cannot be changed').waitFor();
  const dash = await page.evaluate(() => 0); void dash;
});
await step('7g. Inventory: owner edits stock for one pack size and it is saved', async () => {
  await go('/admin/inventory');
  const row = page.locator('tr', { hasText: 'Whole Cumin' }).filter({ hasText: '100g' });
  await row.locator('input.stock-input').fill('42');
  await row.getByRole('button', { name: 'Save' }).click();
  await page.getByText('Stock updated').waitFor();
  assert.equal(q(`select stock_qty from product_variants where label='100g' and product_id=(select id from products where name like 'Whole Cumin%')`), '42');
  await shot('16-admin-inventory');
});
await step('7h. Owner edits a product: change price, remove one pack size, hide it; hidden product vanishes from the shop', async () => {
  await go('/admin/products');
  await page.getByRole('link', { name: 'Almonds (Badam)' }).click();
  await page.locator('.variant-row').nth(0).getByLabel('Price (Rs.)').fill('275');
  await page.locator('.variant-row').nth(1).getByRole('button', { name: 'Remove' }).click();
  await page.getByLabel('Visible in the shop').uncheck({ force: true });
  await page.getByRole('button', { name: 'Save product' }).click(); await page.getByText('Product saved').waitFor();
  assert.equal(q(`select count(*) from product_variants where product_id=(select id from products where name like 'Almonds%')`), '1');
  assert.equal(q(`select price from product_variants where product_id=(select id from products where name like 'Almonds%')`), '275.00');
  await go('/shop'); assert.equal(await page.locator('.pcard').count(), 2);
});
await step('7i. Categories: add, rename, cannot delete a category that has products, delete empty one', async () => {
  await go('/admin/categories');
  await page.getByRole('button', { name: '+ Add category' }).click();
  await page.getByLabel('Name *').fill('Tea & Herbs'); await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('cell', { name: 'Tea & Herbs' }).waitFor();
  page.once('dialog', (d) => d.accept());
  await page.locator('tr', { hasText: 'Ground Spices' }).getByRole('button', { name: 'Delete' }).click();
  await page.getByText(/still has products/).waitFor();
  page.once('dialog', (d) => d.accept());
  await page.locator('tr', { hasText: 'Tea & Herbs' }).getByRole('button', { name: 'Delete' }).click();
  await page.getByText('Category deleted').waitFor();
});
await step('7j. Delivery area can be switched off: customers in it can no longer order', async () => {
  await go('/admin/delivery');
  await page.locator('tr', { hasText: 'Beldanga Town' }).locator('label.switch').click();
  await page.getByText('Area disabled').waitFor();
  await go('/cart'); // empty cart; use API check
  const r = await page.evaluate(async (base) => (await fetch(base + '/rest/v1/rpc/check_delivery', { method: 'POST', headers: { 'content-type': 'application/json', apikey: 'x', authorization: 'Bearer test-anon-key-1234567890' }, body: JSON.stringify({ p_pin: '742175', p_subtotal: 500 }) })).json(), BASE);
  assert.equal(r.deliverable, false);
  await go('/admin/delivery'); await page.locator('tr', { hasText: 'Beldanga Town' }).locator('label.switch').click(); await page.getByText('Area enabled').waitFor();
});
await step('7k. Sales report: totals, daily table, best sellers, CSV export', async () => {
  await go('/admin/reports');
  await page.getByRole('heading', { name: 'Daily sales' }).waitFor();
  await page.getByRole('heading', { name: 'Best-selling products' }).waitFor();
  await page.locator('.stat', { hasText: 'COD orders' }).getByText('1', { exact: true }).waitFor();   // cancelled excluded
  await page.locator('.stat', { hasText: 'Sales (excl. cancelled)' }).getByText('₹490').waitFor();
  await page.getByLabel('Group by').selectOption('month'); await page.getByRole('heading', { name: 'Monthly sales' }).waitFor();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).first().click()]);
  const csv = fs.readFileSync(await dl.path(), 'utf8'); assert.match(csv, /Turmeric Powder/);
  await go('/admin/orders');
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
  const csv2 = fs.readFileSync(await dl2.path(), 'utf8'); assert.match(csv2, new RegExp(orderCode)); assert.match(csv2, /Cash on delivery/);
  await go('/admin/reports'); await shot('17-admin-reports');
});

// ---------------------------------------------------------------- 8. notifications
await step('8a. Notification settings page: shows email and WhatsApp as NOT set up, with clear reasons', async () => {
  await go('/admin/notifications');
  await page.getByRole('heading', { name: 'Notifications' }).waitFor();
  await page.getByText('Missing secret: RESEND_API_KEY').waitFor();
  await page.getByText('Missing secrets: WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID').waitFor();
  assert.equal(await page.getByText('Not set up', { exact: true }).count(), 2);
  await page.getByText('skipped').first().waitFor();
});
await step('8b. Owner saves notification settings (validated)', async () => {
  await page.getByLabel('Owner email address').fill('not-an-email'); await page.getByRole('button', { name: 'Save settings' }).click();
  await page.getByText('The owner email address does not look right.').waitFor();
  await page.getByLabel('Owner email address').fill('owner@example.com'); await page.getByLabel('Owner WhatsApp number').fill('98000 11122');
  await page.getByRole('button', { name: 'Save settings' }).click(); await page.getByText('Notification settings saved').waitFor();
  assert.equal(q(`select owner_email||'/'||owner_whatsapp from notification_settings`), 'owner@example.com/9800011122');
  await shot('18-admin-notifications');
});
await step('8c. Test message when not configured gives a clear explanation', async () => {
  await page.getByRole('button', { name: 'Send test email' }).click();
  await page.getByText('Not sent: RESEND_API_KEY secret is not set.').waitFor();
});
await step('8d. With credentials set (fake providers): owner + customer email and WhatsApp are sent for a new order', async () => {
  await fetch(BASE + '/__control', { method: 'POST', body: JSON.stringify({ reset: true, env: { RESEND_API_KEY: 're_test', WHATSAPP_TOKEN: 'wa_test', WHATSAPP_PHONE_NUMBER_ID: '555' } }) });
  await go('/admin/notifications'); await page.getByText('Connected').first().waitFor();
  assert.equal(await page.getByText('Connected', { exact: true }).count(), 2);
  await page.getByRole('button', { name: 'Send test email' }).click(); await page.getByText(/Test message sent/).first().waitFor();
  // customer orders through the UI
  await go('/shop'); await page.evaluate(() => localStorage.removeItem('mmb.cart.v1'));   // start with an empty cart (step 5 left a now-hidden item)
  await go('/product/whole-cumin-jeera'); await page.getByRole('radio', { name: '500g' }).click(); await page.getByRole('button', { name: 'Add to cart' }).click();
  await page.getByText('Added Whole Cumin').waitFor(); await page.waitForTimeout(300);
  await go('/product/turmeric-powder'); await page.getByRole('button', { name: 'Add to cart' }).click();
  await page.getByText('Added Turmeric Powder').waitFor(); await page.waitForTimeout(300);
  await go('/checkout');
  await page.getByLabel('Full name *').fill('Sumi Paul'); await page.getByLabel('Mobile number *').fill('9700011122'); await page.getByLabel('Email (optional)').fill('sumi@example.com');
  await page.getByLabel('Full address *').fill('Station Road, opposite the bank'); await page.getByLabel('Locality / area *').fill('Kalitala'); await page.getByLabel('City / town *').fill('Beldanga'); await page.getByLabel('PIN code *').fill('742189');
  await page.getByText('We deliver to').first().waitFor();
  await page.getByRole('button', { name: /Place order/ }).click();
  await page.getByRole('heading', { name: /Thank you, Sumi/ }).waitFor();
  const code = (await page.locator('.order-id strong').innerText()).trim();
  await page.waitForTimeout(800);
  const { resend, whatsapp } = await (await fetch(BASE + '/__control', { method: 'POST', body: '{}' })).json();
  const mail = resend.filter((m) => /New order|Order/.test(m.body.subject));
  assert.ok(resend.some((m) => m.body.to[0] === 'owner@example.com' && m.body.subject.includes(code)), 'owner email');
  assert.ok(resend.some((m) => m.body.to[0] === 'sumi@example.com' && m.body.html.includes(code)), 'customer email'); void mail;
  assert.ok(whatsapp.some((m) => m.body.to === '919800011122'), 'owner whatsapp');
  assert.ok(whatsapp.some((m) => m.body.to === '919700011122'), 'customer whatsapp');
  // owner confirms -> customer is notified
  await go('/admin/orders'); await page.getByRole('link', { name: code }).click();
  await page.getByRole('button', { name: 'Mark Confirmed' }).click(); await page.getByText('Order marked Confirmed').waitFor();
  await page.waitForTimeout(800);
  const after = await (await fetch(BASE + '/__control', { method: 'POST', body: '{}' })).json();
  assert.ok(after.resend.some((m) => m.body.to[0] === 'sumi@example.com' && /confirmed/i.test(m.body.subject)), 'status email to customer');
  assert.equal(q(`select count(*) from notification_logs n join orders o on o.id=n.order_id where o.order_code='${code}' and n.status='sent'`), '6');   // 4 on placement (owner+customer x email+WhatsApp) + 2 on confirmation (customer)
});
await step('8e. Provider outage: order is still saved, failure is logged, Retry later succeeds', async () => {
  await fetch(BASE + '/__control', { method: 'POST', body: JSON.stringify({ reset: true, providerMode: { resend: 'fail500', whatsapp: 'fail500' } }) });
  const vid = q(`select id from product_variants where label='100g' and product_id=(select id from products where name='Turmeric Powder')`);
  const o = await page.evaluate(async ({ base, vid }) => (await fetch(base + '/rest/v1/rpc/place_order', { method: 'POST', headers: { 'content-type': 'application/json', apikey: 'x', authorization: 'Bearer test-anon-key-1234567890' }, body: JSON.stringify({ p: { idempotency_key: crypto.randomUUID(), customer: { name: 'Tapan Sen', phone: '9644455566', email: 'tapan@example.com', address: 'Bazar Road, Beldanga', locality: 'Bazar', city: 'Beldanga', state: 'West Bengal', pin: '742175' }, items: [{ variant_id: vid, quantity: 3 }] } }) })).json(), { base: BASE, vid });
  assert.ok(o.order_code);
  await fetch(BASE + '/functions/v1/notifications', { method: 'POST', body: JSON.stringify({ action: 'drain' }) });
  assert.equal(q(`select status from orders where order_code='${o.order_code}'`), 'pending');
  assert.equal(q(`select count(*) from notification_logs n join orders o on o.id=n.order_id where o.order_code='${o.order_code}' and n.status in ('failed','queued')`), '4');
  await go('/admin/notifications'); await page.getByText(/Resend 503|WhatsApp 503/).first().waitFor();
  await shot('19-notification-failure');
  await fetch(BASE + '/__control', { method: 'POST', body: JSON.stringify({ reset: true, providerMode: { resend: 'ok', whatsapp: 'ok' } }) });
  q(`update notification_logs set next_attempt_at = now() - interval '1 second' where status = 'failed'`);
  await page.getByRole('button', { name: 'Send queued messages now' }).click(); await page.getByText('Queued messages processed').waitFor();
  assert.equal(q(`select count(*) from notification_logs n join orders o on o.id=n.order_id where o.order_code='${o.order_code}' and n.status='sent'`), '4');
});

// ---------------------------------------------------------------- 9. layout checks on phone and desktop
await step('9a. No horizontal scrolling on phone screens (customer + admin pages)', async () => {
  for (const p of ['/', '/shop', '/product/turmeric-powder', '/cart', '/checkout', '/track', '/contact', '/policies', '/admin', '/admin/orders', '/admin/products', '/admin/products/new', '/admin/inventory', '/admin/delivery', '/admin/reports', '/admin/notifications', '/admin/settings']) {
    await go(p); await page.waitForTimeout(200);
    const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    assert.ok(w.sw <= w.cw + 1, `${p} overflows: ${w.sw} > ${w.cw}`);
  }
});
await step('9b. Sign out works and the panel is locked again', async () => {
  await go('/admin');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByRole('heading', { name: 'Shop owner sign in' }).waitFor();
  await go('/admin/orders'); await page.getByRole('heading', { name: 'Shop owner sign in' }).waitFor();
});
await step('9c. Unknown page shows a friendly 404', async () => { await go('/nope/nothing'); await page.getByText('Page not found').waitFor(); });
await step('9d. No JavaScript errors or failed requests happened during the whole run', async () => {
  assert.deepEqual(problems.filter((p) => !/status of (400|401|403)/.test(p)), []);
});
{
  const d = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const dp = await d.newPage();
  await dp.goto(BASE + '/', { waitUntil: 'networkidle' }); await dp.screenshot({ path: path.join(shots, '20-desktop-home.png') });
  await dp.goto(BASE + '/shop', { waitUntil: 'networkidle' }); await dp.screenshot({ path: path.join(shots, '21-desktop-shop.png') });
  await d.close();
}
await browser.close(); await gw.close();
const failed = results.filter((r) => r[0] === 'FAIL');
console.log(`\n${results.length - failed.length}/${results.length} steps passed`);
fs.writeFileSync(path.join(shots, 'results.json'), JSON.stringify(results, null, 1));
process.exit(failed.length ? 1 : 0);
