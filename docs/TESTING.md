# 4. Testing

Tests run against a **real PostgreSQL 16** loaded with the real `setup.sql`, with a small stand-in for Supabase's web API, and a **real Chromium browser at phone size (393x851)** using the real built website. Email/WhatsApp providers are simulated (no real messages leave the machine).

## Results (last run)
| Suite | Result |
|---|---|
| Database (`tests/db`): stock, pricing, security, RLS, cancellations, reports | **21 / 21 passed** |
| Notifications (`tests/notify`): content, retries, permanent failures, partial setup, owner-only | **7 / 7 passed** |
| Browser end-to-end (`tests/e2e`) | **45 / 45 steps passed** |
| Production build | passes |

Covered in the browser run: browsing, search/filter/sort, pack sizes, cart (persisting across refresh), invalid phone and missing fields, invalid and disabled PIN codes, browser-tampered totals/prices (refused), double-tap (one order), out-of-stock, stock reduced, order saved with no email/WhatsApp configured, tracking (guessed ID without the right mobile shows nothing), unauthorized `/admin`, wrong password, a signed-in non-owner refused, owner confirms and moves the order through every status with timestamped history, cancellation restores stock exactly once, inventory/category/delivery-area/product editing, sales report + CSV, notification settings, provider outage then retry, no horizontal scroll on phone screens, no JavaScript errors.

## Repeat the tests (computer needed)
```
# start a throw-away PostgreSQL on port 54329 with socket in /tmp, then:
npm install
npm test                                  # database + notification tests
bash tests/db/reset.sh mmb_e2e && PGDB=mmb_e2e node tests/e2e/e2e.mjs
```

## NOT tested (needs your accounts)
* The live Supabase project (the tests use PostgreSQL + a stand-in API; Supabase Auth, Storage and Edge Function hosting were not exercised for real).
* Real Resend and real WhatsApp delivery, and Meta template approval.
* Cloudflare Pages deployment, and a real Android phone (Chromium phone emulation only).
* Load/performance under many simultaneous customers.

## Mobile test checklist (after deployment)
On your Android phone, open the site: browse; add two items with different pack sizes; refresh (cart stays); check out with your own number and a PIN code you added; note the order ID; open `/admin` and confirm it; open **Track order** with the ID + mobile; cancel the test order and check the stock returned.
