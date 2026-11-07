# Mandal Masala Bhandar: online shop + order management

Online store (Cash on Delivery only, local delivery) for **Mandal Masala Bhandar**, Kalitala, Beldanga, Murshidabad, West Bengal 742175.

* **Customers:** browse spices and dry fruits, pick pack sizes (100g / 250g / 500g / 1kg or any size you add), cart, COD checkout, order tracking (order ID **plus** mobile number).
* **Owner (`/admin`):** dashboard, products + photos + pack sizes, categories, inventory, delivery areas and charges, orders and status history, sales reports (CSV), notification settings.
* **Backend:** Supabase (PostgreSQL with Row Level Security, Auth, Storage, one Edge Function for email and WhatsApp). No separate server to rent.
* **Frontend:** React, built with esbuild (the same engine Vite uses inside), plain CSS, hosted free on Cloudflare Pages.

> The shop starts **empty on purpose**: no fake products, orders, delivery areas or prices. The owner adds real ones in `/admin`.

## Start here (in this order)

1. [docs/SETUP.md](docs/SETUP.md): create the database, the owner login, and the notification function in Supabase (phone-friendly).
2. [docs/DEPLOY.md](docs/DEPLOY.md): put the code on GitHub and publish on Cloudflare Pages.
3. [docs/NOTIFICATIONS.md](docs/NOTIFICATIONS.md): turn on email (Resend) and WhatsApp (Meta Cloud API). Optional; orders work without them.
4. [docs/TESTING.md](docs/TESTING.md): what was tested and how to repeat it, and what has **not** been tested.

## How an order is placed safely

The browser sends only product pack IDs and quantities. The database function `place_order` then, in one transaction: validates the customer details, looks up the real prices, checks the PIN code against the owner's delivery areas, applies the owner's delivery charge and minimum order, locks and checks stock (never negative), refuses a total that differs from what the customer was shown, saves the order and items, writes the "Pending" history row, and queues the notifications. A repeated tap re-uses the same idempotency key, so only **one** order is created. Notifications are sent *after* the order is saved, so an email/WhatsApp failure can never lose an order.

## Folder map

| Path | What it is |
|---|---|
| `src/` | Website (customer pages in `pages/`, owner panel in `admin/`) |
| `supabase/setup.sql` | The whole database (tables, security, functions, storage). Safe to re-run |
| `supabase/sql/` | The same SQL in numbered parts (edit these, then `npm run setup-sql`) |
| `supabase/make_owner.sql` | Makes your login the one and only owner |
| `supabase/functions/notifications/index.ts` | Email + WhatsApp sender (paste into Supabase) |
| `tests/` | Database, notification and real-browser tests |
| `.env.example` | The two public settings the website needs |

## Commands (only if you have a computer)

```
npm install
cp .env.example .env     # fill in the two PUBLIC values
npm run build            # website goes to ./dist
npm run dev              # local preview
npm test                 # database + notification tests (needs local PostgreSQL)
```
