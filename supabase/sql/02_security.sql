-- =====================================================================
-- Mandal Masala Bhandar  |  02  ROW LEVEL SECURITY AND PERMISSIONS
-- Row Level Security stays ON for every table. Nothing here makes any
-- table publicly writable.
-- =====================================================================

-- Who is the shop owner?  (profiles row exists, is active, and matches the signed-in user)
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active and p.role = 'owner'
  )
$$;

create or replace function public.require_admin()
returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    raise exception 'You are not allowed to do this.' using errcode = '42501';
  end if;
end $$;

-- ---------- turn RLS on everywhere -------------------------------------
alter table public.profiles              enable row level security;
alter table public.categories            enable row level security;
alter table public.products              enable row level security;
alter table public.product_variants      enable row level security;
alter table public.delivery_zones        enable row level security;
alter table public.store_settings        enable row level security;
alter table public.notification_settings enable row level security;
alter table public.orders                enable row level security;
alter table public.order_items           enable row level security;
alter table public.order_status_history  enable row level security;
alter table public.notification_logs     enable row level security;
alter table public.tracking_attempts     enable row level security;

-- ---------- start from zero privileges ---------------------------------
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- ---------- public (customer) read access: ACTIVE items only -----------
grant select on public.categories      to anon, authenticated;
grant select on public.products        to anon, authenticated;
-- exact stock numbers are NOT readable by the public (in_stock is)
grant select (id, product_id, label, price, compare_at_price, is_available, in_stock, sort_order)
  on public.product_variants to anon;
grant select on public.store_settings to anon, authenticated;

drop policy if exists "public read active categories" on public.categories;
create policy "public read active categories" on public.categories
  for select to anon, authenticated using (is_active);

drop policy if exists "public read active products" on public.products;
create policy "public read active products" on public.products
  for select to anon, authenticated using (is_active);

drop policy if exists "public read variants of active products" on public.product_variants;
create policy "public read variants of active products" on public.product_variants
  for select to anon, authenticated using (
    exists (select 1 from public.products p where p.id = product_id and p.is_active)
  );

drop policy if exists "public read shop details" on public.store_settings;
create policy "public read shop details" on public.store_settings
  for select to anon, authenticated using (true);

-- ---------- owner-only (admin) access ----------------------------------
-- 'authenticated' may touch these tables only if is_admin() is true.
grant select, insert, update, delete on
  public.categories, public.products, public.product_variants, public.delivery_zones,
  public.notification_settings, public.orders, public.order_items,
  public.order_status_history, public.notification_logs
  to authenticated;
grant update on public.store_settings to authenticated;
grant select on public.profiles to authenticated;

do $$
declare t text;
begin
  foreach t in array array['categories','products','product_variants','delivery_zones',
                           'notification_settings','orders','order_items',
                           'order_status_history','notification_logs']
  loop
    execute format('drop policy if exists "owner full access" on public.%I', t);
    execute format('create policy "owner full access" on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

drop policy if exists "owner updates shop details" on public.store_settings;
create policy "owner updates shop details" on public.store_settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- A signed-in user can read only their own profile row. Nobody can write profiles from the API.
drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select to authenticated using (id = auth.uid());

-- tracking_attempts: RLS on, no policies, no grants => only database functions touch it.

-- The database never lets browsers call helper functions directly.
revoke execute on function public.set_updated_at()       from public, anon, authenticated;
revoke execute on function public.check_zone_overlap()   from public, anon, authenticated;
revoke execute on function public.require_admin()        from public, anon, authenticated;
grant  execute on function public.is_admin()             to anon, authenticated;
