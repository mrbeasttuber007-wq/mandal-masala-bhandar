-- =====================================================================
-- Mandal Masala Bhandar  |  01  TABLES, CONSTRAINTS, INDEXES, TRIGGERS
-- Run in: Supabase Dashboard -> SQL Editor (or use the combined setup.sql)
-- Safe to run more than once.
-- =====================================================================

-- ---------- helpers ---------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function public.slugify(p text)
returns text language sql immutable as $$
  select nullif(trim(both '-' from regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', '-', 'g')), '')
$$;

-- ---------- profiles (who may use the admin panel) --------------------
-- Rows here are created ONLY by the owner-bootstrap script (supabase/make_owner.sql)
-- run in the SQL editor. There is deliberately no way to create one from the website.
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text,
  role       text not null default 'owner' check (role = 'owner'),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- categories ------------------------------------------------
create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 2 and 60),
  slug        text not null,
  description text check (char_length(description) <= 300),
  image_url   text,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists categories_name_uq on public.categories (lower(name));
create unique index if not exists categories_slug_uq on public.categories (slug);

-- ---------- products --------------------------------------------------
create table if not exists public.products (
  id                uuid primary key default gen_random_uuid(),
  category_id       uuid not null references public.categories(id) on delete restrict,
  name              text not null check (char_length(btrim(name)) between 2 and 120),
  slug              text not null,
  short_description text check (char_length(short_description) <= 200),
  description       text check (char_length(description) <= 4000),
  image_url         text,
  is_active         boolean not null default true,
  is_featured       boolean not null default false,
  is_best_seller    boolean not null default false,
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index if not exists products_slug_uq on public.products (slug);
create index if not exists products_category_idx on public.products (category_id);
create index if not exists products_active_idx on public.products (is_active, sort_order);

-- ---------- product variants (pack sizes) -----------------------------
create table if not exists public.product_variants (
  id               uuid primary key default gen_random_uuid(),
  product_id       uuid not null references public.products(id) on delete cascade,
  label            text not null check (char_length(btrim(label)) between 1 and 30),
  price            numeric(10,2) not null check (price > 0),
  compare_at_price numeric(10,2) check (compare_at_price is null or compare_at_price > price),
  stock_qty        integer not null default 0 check (stock_qty >= 0),
  is_available     boolean not null default true,
  sku              text,
  sort_order       integer not null default 0,
  -- Safe to show publicly: tells customers if it can be bought without revealing exact stock.
  in_stock         boolean generated always as (is_available and stock_qty > 0) stored,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (product_id, label)
);
create index if not exists variants_product_idx on public.product_variants (product_id);
create index if not exists variants_stock_idx on public.product_variants (stock_qty);

-- ---------- delivery zones --------------------------------------------
create table if not exists public.delivery_zones (
  id                      uuid primary key default gen_random_uuid(),
  name                    text not null check (char_length(btrim(name)) between 2 and 80),
  pin_codes               text[] not null,
  delivery_charge         numeric(10,2) not null default 0 check (delivery_charge >= 0),
  min_order_value         numeric(10,2) not null default 0 check (min_order_value >= 0),
  free_delivery_threshold numeric(10,2) check (free_delivery_threshold is null or free_delivery_threshold > 0),
  is_active               boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint pin_codes_valid check (
    cardinality(pin_codes) >= 1
    and array_to_string(pin_codes, ',') ~ '^[1-9][0-9]{5}(,[1-9][0-9]{5})*$'
  )
);

-- A PIN code may belong to only one ACTIVE zone, so the charge is never ambiguous.
create or replace function public.check_zone_overlap()
returns trigger language plpgsql as $$
begin
  if new.is_active and exists (
    select 1 from public.delivery_zones z
    where z.is_active and z.id <> new.id and z.pin_codes && new.pin_codes
  ) then
    raise exception 'Another active delivery zone already uses one of these PIN codes.'
      using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists delivery_zones_overlap on public.delivery_zones;
create trigger delivery_zones_overlap before insert or update on public.delivery_zones
  for each row execute function public.check_zone_overlap();

-- ---------- store settings (public shop details; single row) ----------
create table if not exists public.store_settings (
  id                  smallint primary key default 1 check (id = 1),
  shop_name           text not null default 'Mandal Masala Bhandar',
  tagline             text,
  address             text,
  contact_phone       text,
  contact_whatsapp    text,
  contact_email       text,
  opening_hours       text,
  hero_title          text,
  hero_subtitle       text,
  announcement        text,
  about_text          text,
  delivery_policy     text,
  return_policy       text,
  privacy_policy      text,
  terms_text          text,
  low_stock_threshold integer not null default 5 check (low_stock_threshold >= 0),
  updated_at          timestamptz not null default now()
);

-- ---------- notification settings (PRIVATE; owner contact + toggles) --
-- API keys are NOT stored here. They live in Edge Function secrets.
create table if not exists public.notification_settings (
  id                         smallint primary key default 1 check (id = 1),
  owner_email                text check (owner_email is null or owner_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  owner_whatsapp             text check (owner_whatsapp is null or owner_whatsapp ~ '^[6-9][0-9]{9}$'),
  owner_email_enabled        boolean not null default true,
  customer_email_enabled     boolean not null default true,
  owner_whatsapp_enabled     boolean not null default true,
  customer_whatsapp_enabled  boolean not null default true,
  email_from                 text check (char_length(email_from) <= 200),
  wa_template_owner_new      text not null default 'mmb_owner_new_order',
  wa_template_customer_confirm text not null default 'mmb_order_confirmation',
  wa_template_customer_status  text not null default 'mmb_order_status',
  wa_template_language       text not null default 'en',
  updated_at                 timestamptz not null default now()
);

-- ---------- orders ----------------------------------------------------
create table if not exists public.orders (
  id               uuid primary key default gen_random_uuid(),
  order_code       text not null unique,
  idempotency_key  uuid not null unique,
  status           text not null default 'pending'
                   check (status in ('pending','confirmed','processing','out_for_delivery','delivered','cancelled')),
  customer_name    text not null check (char_length(customer_name) between 2 and 80),
  customer_phone   text not null check (customer_phone ~ '^[6-9][0-9]{9}$'),
  customer_email   text check (customer_email is null or customer_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  address_line     text not null,
  locality         text not null,
  city             text not null,
  state            text not null,
  pin_code         text not null check (pin_code ~ '^[1-9][0-9]{5}$'),
  notes            text check (char_length(notes) <= 500),
  delivery_zone_id uuid references public.delivery_zones(id) on delete set null,
  delivery_zone_name text,
  subtotal         numeric(12,2) not null check (subtotal >= 0),
  delivery_charge  numeric(10,2) not null check (delivery_charge >= 0),
  total            numeric(12,2) not null check (total >= 0),
  payment_method   text not null default 'cod' check (payment_method = 'cod'),
  stock_deducted   boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint total_matches check (total = subtotal + delivery_charge)
);
create index if not exists orders_created_idx on public.orders (created_at desc);
create index if not exists orders_status_idx on public.orders (status, created_at desc);
create index if not exists orders_phone_idx on public.orders (customer_phone, created_at desc);

create table if not exists public.order_items (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders(id) on delete cascade,
  variant_id    uuid references public.product_variants(id) on delete set null,
  product_id    uuid,
  product_name  text not null,
  variant_label text not null,
  unit_price    numeric(10,2) not null check (unit_price > 0),
  quantity      integer not null check (quantity > 0),
  line_total    numeric(12,2) not null check (line_total > 0),
  created_at    timestamptz not null default now(),
  constraint line_total_matches check (line_total = unit_price * quantity)
);
create index if not exists order_items_order_idx on public.order_items (order_id);
create index if not exists order_items_variant_idx on public.order_items (variant_id);

create table if not exists public.order_status_history (
  id          bigint generated always as identity primary key,
  order_id    uuid not null references public.orders(id) on delete cascade,
  from_status text,
  to_status   text not null,
  note        text check (char_length(note) <= 300),
  changed_by  uuid,
  changed_at  timestamptz not null default now()
);
create index if not exists order_history_order_idx on public.order_status_history (order_id, changed_at);

-- ---------- notification log + outbox ---------------------------------
-- One row per message to send. The order is saved first; these rows are
-- processed afterwards, so a failing provider never loses an order.
create table if not exists public.notification_logs (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references public.orders(id) on delete cascade,
  channel             text not null check (channel in ('email','whatsapp')),
  recipient_type      text not null check (recipient_type in ('owner','customer')),
  event               text not null check (event in ('order_placed','confirmed','out_for_delivery','delivered','cancelled')),
  recipient           text,
  status              text not null default 'queued'
                      check (status in ('queued','sending','sent','failed','skipped')),
  attempts            integer not null default 0,
  next_attempt_at     timestamptz not null default now(),
  locked_until        timestamptz,
  last_error          text,
  provider_message_id text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  sent_at             timestamptz,
  unique (order_id, channel, recipient_type, event)
);
create index if not exists notif_pending_idx on public.notification_logs (status, next_attempt_at);
create index if not exists notif_order_idx on public.notification_logs (order_id);

-- Failed order-tracking lookups (used to slow down guessing).
create table if not exists public.tracking_attempts (
  id         bigint generated always as identity primary key,
  order_code text not null,
  created_at timestamptz not null default now()
);
create index if not exists tracking_attempts_idx on public.tracking_attempts (order_code, created_at);

-- ---------- updated_at triggers ---------------------------------------
do $$
declare t text;
begin
  foreach t in array array['profiles','categories','products','product_variants','delivery_zones',
                           'store_settings','notification_settings','orders','notification_logs']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
                   t || '_updated_at', t);
  end loop;
end $$;

-- ---------- starting data (NOT products, NOT prices) ------------------
insert into public.store_settings (id, shop_name, tagline, address, hero_title, hero_subtitle,
                                   about_text, delivery_policy, return_policy, privacy_policy, terms_text)
values (1, 'Mandal Masala Bhandar', 'Spices & dry fruits, Kalitala, Beldanga',
        'Kalitala, Beldanga, Murshidabad, West Bengal 742175, India',
        'Fresh spices. Honest weights. At your door.',
        'Whole spices, ground masalas, blends and dry fruits from our shop in Beldanga. Order online and pay cash on delivery.',
        'Mandal Masala Bhandar is a spice and dry fruit shop in Kalitala, Beldanga, Murshidabad. This website lets you order from the shop and have it delivered locally. You pay in cash when your order arrives.',
        'We deliver only to the areas listed on this site. Delivery charges and any minimum order value depend on your area and are shown before you place the order. Payment is cash on delivery only.',
        'If an item you receive is damaged or not what you ordered, please contact the shop on the same day and we will make it right.',
        'We use your name, mobile number and address only to deliver your order and to send you updates about it. We do not sell your information.',
        'By placing an order you agree to pay the total shown at checkout in cash on delivery. Orders may be declined or cancelled if an item is out of stock or the address is outside our delivery area.')
on conflict (id) do nothing;

insert into public.notification_settings (id) values (1) on conflict (id) do nothing;

insert into public.categories (name, slug, description, sort_order) values
  ('Whole Spices',  'whole-spices',  'Cumin, cardamom, cloves, cinnamon and more, whole and aromatic.', 1),
  ('Ground Spices', 'ground-spices', 'Freshly ground turmeric, chilli, coriander and everyday powders.', 2),
  ('Masala Blends', 'masala-blends',  'Ready-to-use blends for curries, biryani and snacks.', 3),
  ('Dry Fruits',    'dry-fruits',    'Almonds, cashews, raisins, dates and other dry fruits.', 4)
on conflict do nothing;
