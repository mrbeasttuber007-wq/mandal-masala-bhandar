# 1. Supabase setup (about 15 minutes, all on your phone)

You already have a Supabase account. Use Chrome on Android; if a page looks cramped, open Chrome's menu and tick **Desktop site**.

## A. Create the project
1. supabase.com → **Dashboard** → **New project**. Name: `mandal-masala`. Choose a strong database password (save it in a password manager; the website never needs it). Region: **Mumbai (ap-south-1)** if offered (closest to Beldanga).
2. Wait until the project says it is ready.

## B. Create the database
1. Open the project → **SQL Editor** → **New query**.
2. Open the file `supabase/setup.sql` from this project, copy **everything**, paste it into the editor, and press **Run**.
3. You should see "Success". It is safe to run again if you are unsure.

This creates the tables (categories, products, product variants, orders, order items, status history, delivery zones, store settings, notification logs, profiles), the security rules (Row Level Security is ON for every table), the secure order function, and a private-write / public-read **product-images** storage bucket.

## C. Create the owner login
1. **Authentication** → **Users** → **Add user** → **Create new user**. Enter the owner's email and a strong password. Tick **Auto Confirm User**.
2. **Authentication → Sign In / Providers**: turn **off** "Allow new users to sign up" (so strangers cannot create accounts).
3. **SQL Editor** → new query. Paste `supabase/make_owner.sql`, change `owner@example.com` to the owner's email, **Run**. The last line must show one row with role `owner`.

Only a person listed in the `profiles` table can use `/admin`. Being signed in is not enough.

## D. Copy the two public values for the website
**Project Settings → API** (or "API Keys"):
* **Project URL**, like `https://abcdxyz.supabase.co`
* **anon / publishable key**: the *public* one.

> Never copy the **service_role / secret** key into the website. The build refuses to continue if it detects one.

## E. Create the notification function (can be done later)
1. **Edge Functions** → **Deploy a new function** → **Via Editor** → name it exactly `notifications`.
2. Paste the whole of `supabase/functions/notifications/index.ts` and **Deploy**.
3. If the website later reports "401" from this function, open the function's settings and switch **Verify JWT** off (customers call it without logging in; the function itself restricts owner-only actions).
4. Secrets are added in [NOTIFICATIONS.md](NOTIFICATIONS.md). Without them, orders still work and messages are simply marked "skipped".

## F. First login and shop set-up
Open `https://YOUR-SITE/admin`, sign in, then:
1. **Delivery areas**: add the PIN codes you deliver to, the delivery charge, optional minimum order and free-delivery threshold. *Until you add one, customers cannot order*; nothing is pre-filled.
2. **Shop details**: phone, address, opening hours.
3. **Categories** (Whole Spices, Ground Spices, Masala Blends, Dry Fruits, or your own).
4. **Products**: add photos and pack sizes with price and stock for each.
