# 3. Email and WhatsApp notifications

**Honest status:** the sending code is built and tested against *simulated* Resend and WhatsApp servers (see TESTING.md). It has **not** been run against the real Resend or Meta services, because that needs your accounts and keys. Orders work fully without any of this; unsent messages are marked **skipped** with the reason, and the owner gets a manual **Send on WhatsApp** button on every order.

How it works: when an order is placed or its status changes, the database writes rows into `notification_logs`. The `notifications` Edge Function sends what is due, records `sent` / `failed` / `skipped`, retries temporary failures (up to 5 tries), and treats a rejected address/number as a permanent failure. Keys live only in Supabase **Edge Function secrets** (never in the website or the database).

Messages sent: owner new-order alert; customer order confirmation; customer updates for **confirmed, out for delivery, delivered, cancelled**. Owner can switch each group on/off in `/admin` → **Notifications**.

When are failed messages retried? Whenever the owner changes an order status, opens the Notifications page, or presses **Send queued now**, and after each new order. There is no background timer on the free plan; if you want one, add a Supabase scheduled job that calls the function with `{"action":"drain"}` every few minutes.

## A. Email with Resend (free tier)
1. resend.com → sign up → **API Keys** → create a key.
2. For real customers you must **verify a domain** you own (Resend → Domains). Without one, Resend only delivers to your own account email (fine for testing).
3. Supabase → **Edge Functions → Secrets**: add `RESEND_API_KEY`, and optionally `EMAIL_FROM` (e.g. `Mandal Masala <orders@yourdomain.com>`) and `SITE_URL` (your Pages address).
4. `/admin` → **Notifications**: enter the owner email, press **Send test email**.

## B. WhatsApp Business Cloud API (Meta)
1. developers.facebook.com → create an app (type Business) → add **WhatsApp**. You need a Meta Business account and a phone number for the API (it cannot be one already used in the normal WhatsApp app).
2. Create a **permanent access token** (System User) and note the **Phone number ID**.
3. Supabase secrets: `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`.
4. In WhatsApp Manager create and get approved these **message templates** (category Utility, language `en`). Names can be changed in `/admin` → Notifications.

| Template name | Body (variables in order) |
|---|---|
| `mmb_owner_new_order` | `New order {{1}} from {{2}} ({{3}}). Items: {{4}}. Total {{5}} (Cash on Delivery). Address: {{6}}` |
| `mmb_order_confirmation` | `Hello {{1}}, we received your order {{2}}. Total {{3}} to pay on delivery. Thank you, Mandal Masala Bhandar.` |
| `mmb_order_status` | `Hello {{1}}, your order {{2}} is now: {{3}}. Mandal Masala Bhandar.` |

5. Until templates are approved, WhatsApp shows failed/skipped in the log and everything else keeps working. In Meta's test mode you can message only numbers you added as test recipients.

Note: Meta charges per conversation after a free monthly allowance; check current pricing.
