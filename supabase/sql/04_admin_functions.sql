-- =====================================================================
-- Mandal Masala Bhandar  |  04  OWNER-ONLY (ADMIN) DATABASE FUNCTIONS
-- Every function starts with require_admin(): anyone who is not the
-- signed-in shop owner gets "You are not allowed to do this."
-- =====================================================================

create or replace function public.nz(p text)
returns text language sql immutable as $$ select nullif(btrim(coalesce(p, '')), '') $$;

-- ---------- categories -------------------------------------------------
create or replace function public.admin_list_categories()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.require_admin();
  return coalesce((select jsonb_agg(to_jsonb(c) || jsonb_build_object(
            'product_count', (select count(*) from public.products p where p.category_id = c.id))
          order by c.sort_order, c.name) from public.categories c), '[]'::jsonb);
end $$;

create or replace function public.admin_save_category(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := nullif(p->>'id', '')::uuid; v_name text := btrim(coalesce(p->>'name', '')); v_slug text; n integer := 1; r public.categories;
begin
  perform public.require_admin();
  if char_length(v_name) < 2 then raise exception 'Please enter a category name.' using errcode = 'P0001'; end if;
  if v_id is null then
    v_slug := coalesce(public.slugify(v_name), 'category');
    while exists (select 1 from public.categories where slug = v_slug) loop
      n := n + 1; v_slug := public.slugify(v_name) || '-' || n;
    end loop;
    insert into public.categories (name, slug, description, image_url, sort_order, is_active)
    values (v_name, v_slug, public.nz(p->>'description'), public.nz(p->>'image_url'),
            coalesce((p->>'sort_order')::integer, 0), coalesce((p->>'is_active')::boolean, true))
    returning * into r;
  else
    update public.categories set name = v_name, description = public.nz(p->>'description'),
           image_url = public.nz(p->>'image_url'), sort_order = coalesce((p->>'sort_order')::integer, sort_order),
           is_active = coalesce((p->>'is_active')::boolean, is_active)
     where id = v_id returning * into r;
    if not found then raise exception 'Category not found.' using errcode = 'P0001'; end if;
  end if;
  return to_jsonb(r);
exception when unique_violation then
  raise exception 'A category with this name already exists.' using errcode = 'P0001';
end $$;

create or replace function public.admin_delete_category(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.require_admin();
  delete from public.categories where id = p_id;
  return jsonb_build_object('ok', true);
exception when foreign_key_violation then
  raise exception 'This category still has products. Move or delete those products first, or just switch the category off.'
    using errcode = 'P0001';
end $$;

-- ---------- products + variants ---------------------------------------
create or replace function public.product_admin_json(p_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select to_jsonb(p) || jsonb_build_object(
    'category_name', c.name,
    'variants', coalesce((select jsonb_agg(to_jsonb(v) order by v.sort_order, v.price)
                          from public.product_variants v where v.product_id = p.id), '[]'::jsonb))
  from public.products p join public.categories c on c.id = p.category_id
  where p.id = p_id
$$;

create or replace function public.admin_list_products()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.require_admin();
  return coalesce((select jsonb_agg(public.product_admin_json(p.id) order by p.sort_order, p.name)
                   from public.products p), '[]'::jsonb);
end $$;

-- Create or update a product and its pack sizes in one go.
-- p.variants: pack sizes to add or update (with "id" = update, without = add)
-- p.remove_variant_ids: pack sizes to remove
create or replace function public.admin_save_product(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid := nullif(p->>'id', '')::uuid; v_name text := btrim(coalesce(p->>'name', '')); v_slug text; n integer := 1;
  v jsonb; v_vid uuid; v_label text; v_price numeric; v_cmp numeric; v_cnt integer;
begin
  perform public.require_admin();
  if char_length(v_name) < 2 then raise exception 'Please enter a product name.' using errcode = 'P0001'; end if;
  if nullif(p->>'category_id', '') is null then raise exception 'Please choose a category.' using errcode = 'P0001'; end if;

  if v_id is null then
    v_slug := coalesce(public.slugify(v_name), 'product');
    while exists (select 1 from public.products where slug = v_slug) loop
      n := n + 1; v_slug := public.slugify(v_name) || '-' || n;
    end loop;
    insert into public.products (category_id, name, slug, short_description, description, image_url,
                                 is_active, is_featured, is_best_seller, sort_order)
    values ((p->>'category_id')::uuid, v_name, v_slug, public.nz(p->>'short_description'), public.nz(p->>'description'),
            public.nz(p->>'image_url'), coalesce((p->>'is_active')::boolean, true),
            coalesce((p->>'is_featured')::boolean, false), coalesce((p->>'is_best_seller')::boolean, false),
            coalesce((p->>'sort_order')::integer, 0))
    returning id into v_id;
  else
    update public.products set category_id = (p->>'category_id')::uuid, name = v_name,
           short_description = public.nz(p->>'short_description'), description = public.nz(p->>'description'),
           image_url = public.nz(p->>'image_url'), is_active = coalesce((p->>'is_active')::boolean, is_active),
           is_featured = coalesce((p->>'is_featured')::boolean, is_featured),
           is_best_seller = coalesce((p->>'is_best_seller')::boolean, is_best_seller),
           sort_order = coalesce((p->>'sort_order')::integer, sort_order)
     where id = v_id;
    if not found then raise exception 'Product not found.' using errcode = 'P0001'; end if;
  end if;

  if jsonb_typeof(p->'remove_variant_ids') = 'array' then
    delete from public.product_variants
     where product_id = v_id and id in (select (x)::uuid from jsonb_array_elements_text(p->'remove_variant_ids') x);
  end if;

  if jsonb_typeof(p->'variants') = 'array' then
    for v in select * from jsonb_array_elements(p->'variants') loop
      v_vid := nullif(v->>'id', '')::uuid;
      v_label := btrim(coalesce(v->>'label', ''));
      v_price := (v->>'price')::numeric;
      v_cmp := nullif(v->>'compare_at_price', '')::numeric;
      if v_label = '' then raise exception 'Every pack size needs a label such as 250g.' using errcode = 'P0001'; end if;
      if v_price is null or v_price <= 0 then raise exception 'Pack size % needs a price above 0.', v_label using errcode = 'P0001'; end if;
      if v_cmp is not null and v_cmp <= v_price then
        raise exception 'For %, the old (crossed-out) price must be higher than the selling price.', v_label using errcode = 'P0001';
      end if;
      if v_vid is null then
        insert into public.product_variants (product_id, label, price, compare_at_price, stock_qty, is_available, sku, sort_order)
        values (v_id, v_label, v_price, v_cmp, coalesce((v->>'stock_qty')::integer, 0),
                coalesce((v->>'is_available')::boolean, true), public.nz(v->>'sku'), coalesce((v->>'sort_order')::integer, 0));
      else
        update public.product_variants set label = v_label, price = v_price, compare_at_price = v_cmp,
               stock_qty = coalesce((v->>'stock_qty')::integer, stock_qty),
               is_available = coalesce((v->>'is_available')::boolean, is_available),
               sku = public.nz(v->>'sku'), sort_order = coalesce((v->>'sort_order')::integer, sort_order)
         where id = v_vid and product_id = v_id;
        get diagnostics v_cnt = row_count;
        if v_cnt = 0 then raise exception 'A pack size could not be found. Please reload and try again.' using errcode = 'P0001'; end if;
      end if;
    end loop;
  end if;
  return public.product_admin_json(v_id);
exception
  when unique_violation then
    raise exception 'Each pack size can be added only once per product (for example, only one 250g).' using errcode = 'P0001';
  when check_violation then
    raise exception 'Please check the values: stock cannot be negative and prices must be above 0.' using errcode = 'P0001';
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'Please check the numbers you entered.' using errcode = 'P0001';
end $$;

create or replace function public.admin_delete_product(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.require_admin();
  delete from public.products where id = p_id;   -- pack sizes go with it; past orders keep their own copy of names/prices
  return jsonb_build_object('ok', true);
end $$;

-- Quick stock edit from the inventory screen.
create or replace function public.admin_set_variant_stock(p_id uuid, p_stock integer, p_available boolean default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.product_variants;
begin
  perform public.require_admin();
  if p_stock is null or p_stock < 0 then raise exception 'Stock cannot be negative.' using errcode = 'P0001'; end if;
  update public.product_variants set stock_qty = p_stock, is_available = coalesce(p_available, is_available)
   where id = p_id returning * into r;
  if not found then raise exception 'Pack size not found.' using errcode = 'P0001'; end if;
  return to_jsonb(r);
end $$;

-- ---------- delivery zones --------------------------------------------
create or replace function public.admin_list_zones()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.require_admin();
  return coalesce((select jsonb_agg(to_jsonb(z) order by z.name) from public.delivery_zones z), '[]'::jsonb);
end $$;

create or replace function public.admin_save_zone(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := nullif(p->>'id', '')::uuid; v_pins text[]; r public.delivery_zones;
begin
  perform public.require_admin();
  select coalesce(array_agg(distinct btrim(x)), '{}') into v_pins
    from regexp_split_to_table(coalesce(p->>'pin_codes', ''), '[\s,;]+') x where btrim(x) <> '';
  if cardinality(v_pins) = 0 or array_to_string(v_pins, ',') !~ '^[1-9][0-9]{5}(,[1-9][0-9]{5})*$' then
    raise exception 'Please enter one or more valid 6-digit PIN codes, separated by commas.' using errcode = 'P0001';
  end if;
  if v_id is null then
    insert into public.delivery_zones (name, pin_codes, delivery_charge, min_order_value, free_delivery_threshold, is_active)
    values (btrim(coalesce(p->>'name', '')), v_pins, coalesce((p->>'delivery_charge')::numeric, 0),
            coalesce((p->>'min_order_value')::numeric, 0), nullif(p->>'free_delivery_threshold', '')::numeric,
            coalesce((p->>'is_active')::boolean, true))
    returning * into r;
  else
    update public.delivery_zones set name = btrim(coalesce(p->>'name', '')), pin_codes = v_pins,
           delivery_charge = coalesce((p->>'delivery_charge')::numeric, 0),
           min_order_value = coalesce((p->>'min_order_value')::numeric, 0),
           free_delivery_threshold = nullif(p->>'free_delivery_threshold', '')::numeric,
           is_active = coalesce((p->>'is_active')::boolean, is_active)
     where id = v_id returning * into r;
    if not found then raise exception 'Delivery zone not found.' using errcode = 'P0001'; end if;
  end if;
  return to_jsonb(r);
exception when check_violation then
  raise exception 'Please check the zone: it needs a name, charges cannot be negative, and the free-delivery amount must be above 0.'
    using errcode = 'P0001';
end $$;

create or replace function public.admin_delete_zone(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.require_admin();
  delete from public.delivery_zones where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- settings ---------------------------------------------------
create or replace function public.admin_get_settings()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.require_admin();
  return jsonb_build_object(
    'store', (select to_jsonb(s) from public.store_settings s where s.id = 1),
    'notifications', (select to_jsonb(n) from public.notification_settings n where n.id = 1));
end $$;

create or replace function public.admin_save_store_settings(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.store_settings;
begin
  perform public.require_admin();
  update public.store_settings set
    shop_name = coalesce(public.nz(p->>'shop_name'), shop_name),
    tagline = public.nz(p->>'tagline'), address = public.nz(p->>'address'),
    contact_phone = public.nz(p->>'contact_phone'), contact_whatsapp = public.nz(p->>'contact_whatsapp'),
    contact_email = public.nz(p->>'contact_email'), opening_hours = public.nz(p->>'opening_hours'),
    hero_title = public.nz(p->>'hero_title'), hero_subtitle = public.nz(p->>'hero_subtitle'),
    announcement = public.nz(p->>'announcement'), about_text = public.nz(p->>'about_text'),
    delivery_policy = public.nz(p->>'delivery_policy'), return_policy = public.nz(p->>'return_policy'),
    privacy_policy = public.nz(p->>'privacy_policy'), terms_text = public.nz(p->>'terms_text'),
    low_stock_threshold = coalesce((p->>'low_stock_threshold')::integer, low_stock_threshold)
   where id = 1 returning * into r;
  return to_jsonb(r);
exception when check_violation then
  raise exception 'Low-stock level cannot be negative.' using errcode = 'P0001';
end $$;

create or replace function public.admin_save_notification_settings(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.notification_settings; v_wa text := public.nz(p->>'owner_whatsapp'); v_email text := public.nz(p->>'owner_email');
begin
  perform public.require_admin();
  if v_wa is not null then
    v_wa := public.normalize_phone(v_wa);
    if v_wa is null then raise exception 'The owner WhatsApp number must be a valid 10-digit Indian mobile number.' using errcode = 'P0001'; end if;
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'The owner email address does not look right.' using errcode = 'P0001';
  end if;
  update public.notification_settings set
    owner_email = v_email, owner_whatsapp = v_wa,
    owner_email_enabled = coalesce((p->>'owner_email_enabled')::boolean, owner_email_enabled),
    customer_email_enabled = coalesce((p->>'customer_email_enabled')::boolean, customer_email_enabled),
    owner_whatsapp_enabled = coalesce((p->>'owner_whatsapp_enabled')::boolean, owner_whatsapp_enabled),
    customer_whatsapp_enabled = coalesce((p->>'customer_whatsapp_enabled')::boolean, customer_whatsapp_enabled),
    email_from = public.nz(p->>'email_from'),
    wa_template_owner_new = coalesce(public.nz(p->>'wa_template_owner_new'), wa_template_owner_new),
    wa_template_customer_confirm = coalesce(public.nz(p->>'wa_template_customer_confirm'), wa_template_customer_confirm),
    wa_template_customer_status = coalesce(public.nz(p->>'wa_template_customer_status'), wa_template_customer_status),
    wa_template_language = coalesce(public.nz(p->>'wa_template_language'), wa_template_language)
   where id = 1 returning * into r;
  return to_jsonb(r);
exception when check_violation then
  raise exception 'Please check the notification settings (email format, WhatsApp number).' using errcode = 'P0001';
end $$;

-- ---------- orders -----------------------------------------------------
create or replace function public.admin_list_orders(p jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_search text := public.nz(p->>'search'); v_status text := public.nz(p->>'status');
  v_digits text := regexp_replace(coalesce(p->>'search', ''), '\D', '', 'g');
  v_from date := nullif(p->>'from', '')::date; v_to date := nullif(p->>'to', '')::date;
  v_limit integer := least(greatest(coalesce((p->>'limit')::integer, 50), 1), 1000);
  v_offset integer := greatest(coalesce((p->>'offset')::integer, 0), 0);
  v_total integer; v_rows jsonb;
begin
  perform public.require_admin();
  with f as (
    select o.* from public.orders o
     where (v_status is null or o.status = v_status)
       and (v_from is null or o.created_at >= (v_from::timestamp at time zone 'Asia/Kolkata'))
       and (v_to is null or o.created_at < ((v_to + 1)::timestamp at time zone 'Asia/Kolkata'))
       and (v_search is null
            or o.order_code ilike '%' || v_search || '%'
            or o.customer_name ilike '%' || v_search || '%'
            or (char_length(v_digits) >= 3 and o.customer_phone like '%' || v_digits || '%'))
  )
  select (select count(*) from f),
         coalesce((select jsonb_agg(x.j order by x.created_at desc) from (
            select f.created_at, jsonb_build_object(
              'id', f.id, 'order_code', f.order_code, 'status', f.status, 'created_at', f.created_at,
              'customer_name', f.customer_name, 'customer_phone', f.customer_phone, 'city', f.city, 'pin_code', f.pin_code,
              'address', f.address_line || ', ' || f.locality || ', ' || f.city || ', ' || f.state || ' ' || f.pin_code,
              'subtotal', f.subtotal, 'delivery_charge', f.delivery_charge, 'total', f.total, 'payment_method', f.payment_method,
              'items_summary', (select string_agg(i.product_name || ' (' || i.variant_label || ') x ' || i.quantity, '; ' order by i.created_at)
                                from public.order_items i where i.order_id = f.id)) as j
            from f order by f.created_at desc limit v_limit offset v_offset) x), '[]'::jsonb)
    into v_total, v_rows;
  return jsonb_build_object('total', v_total, 'orders', v_rows);
end $$;

create or replace function public.admin_get_order(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare o public.orders;
begin
  perform public.require_admin();
  select * into o from public.orders where id = p_id;
  if not found then raise exception 'Order not found.' using errcode = 'P0001'; end if;
  return to_jsonb(o) || jsonb_build_object(
    'items', public.order_items_json(o.id),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('from_status', h.from_status, 'to_status', h.to_status,
                  'note', h.note, 'at', h.changed_at) order by h.changed_at, h.id), '[]'::jsonb)
                from public.order_status_history h where h.order_id = o.id),
    'notifications', (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'channel', n.channel,
                  'recipient_type', n.recipient_type, 'event', n.event, 'status', n.status, 'attempts', n.attempts,
                  'last_error', n.last_error, 'sent_at', n.sent_at, 'created_at', n.created_at) order by n.created_at), '[]'::jsonb)
                from public.notification_logs n where n.order_id = o.id));
end $$;

-- Move an order to a new status. Forward only (Pending -> ... -> Delivered); Cancel is allowed
-- until Delivered. Cancelling puts the stock back, exactly once.
create or replace function public.admin_update_order_status(p_id uuid, p_status text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare o public.orders; v_event text;
begin
  perform public.require_admin();
  if public.order_status_rank(p_status) is null then
    raise exception 'Unknown status.' using errcode = 'P0001';
  end if;
  select * into o from public.orders where id = p_id for update;
  if not found then raise exception 'Order not found.' using errcode = 'P0001'; end if;
  if o.status = p_status then
    raise exception 'This order is already %.', replace(initcap(o.status), '_', ' ') using errcode = 'P0001';
  end if;
  if o.status in ('delivered', 'cancelled') then
    raise exception 'A % order cannot be changed.', replace(o.status, '_', ' ') using errcode = 'P0001';
  end if;
  if p_status <> 'cancelled' and public.order_status_rank(p_status) < public.order_status_rank(o.status) then
    raise exception 'An order cannot go back to an earlier status.' using errcode = 'P0001';
  end if;

  if p_status = 'cancelled' and o.stock_deducted then
    update public.product_variants v set stock_qty = v.stock_qty + i.quantity
      from public.order_items i where i.order_id = o.id and i.variant_id = v.id;
    update public.orders set stock_deducted = false where id = o.id;
  end if;

  update public.orders set status = p_status where id = o.id;
  insert into public.order_status_history (order_id, from_status, to_status, note, changed_by)
  values (o.id, o.status, p_status, left(public.nz(p_note), 300), auth.uid());

  v_event := case p_status when 'confirmed' then 'confirmed' when 'out_for_delivery' then 'out_for_delivery'
                           when 'delivered' then 'delivered' when 'cancelled' then 'cancelled' end;
  if v_event is not null then perform public.enqueue_notifications(o.id, v_event); end if;
  return public.admin_get_order(o.id);
end $$;

-- ---------- dashboard + reports ---------------------------------------
create or replace function public.admin_dashboard()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_today date := (now() at time zone 'Asia/Kolkata')::date; v_thr integer;
begin
  perform public.require_admin();
  select low_stock_threshold into v_thr from public.store_settings where id = 1;
  return jsonb_build_object(
    'total_orders', (select count(*) from public.orders),
    'todays_orders', (select count(*) from public.orders where (created_at at time zone 'Asia/Kolkata')::date = v_today),
    'pending_orders', (select count(*) from public.orders where status = 'pending'),
    'in_progress_orders', (select count(*) from public.orders where status in ('confirmed','processing','out_for_delivery')),
    'completed_orders', (select count(*) from public.orders where status = 'delivered'),
    'cancelled_orders', (select count(*) from public.orders where status = 'cancelled'),
    'total_sales', (select coalesce(sum(total), 0) from public.orders where status <> 'cancelled'),
    'delivered_sales', (select coalesce(sum(total), 0) from public.orders where status = 'delivered'),
    'todays_sales', (select coalesce(sum(total), 0) from public.orders
                      where status <> 'cancelled' and (created_at at time zone 'Asia/Kolkata')::date = v_today),
    'low_stock_threshold', v_thr,
    'low_stock', (select coalesce(jsonb_agg(jsonb_build_object('variant_id', v.id, 'product_id', p.id,
                    'product_name', p.name, 'label', v.label, 'stock_qty', v.stock_qty, 'is_available', v.is_available)
                    order by v.stock_qty, p.name), '[]'::jsonb)
                  from public.product_variants v join public.products p on p.id = v.product_id
                  where p.is_active and v.stock_qty <= v_thr),
    'recent_orders', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'order_code', o.order_code, 'status', o.status,
                    'customer_name', o.customer_name, 'total', o.total, 'created_at', o.created_at) order by o.created_at desc), '[]'::jsonb)
                  from (select * from public.orders order by created_at desc limit 8) o),
    'failed_notifications', (select count(*) from public.notification_logs where status = 'failed'));
end $$;

create or replace function public.admin_sales_report(p jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_to date := coalesce(nullif(p->>'to', '')::date, v_today);
  v_from date := coalesce(nullif(p->>'from', '')::date, v_to - 29);
  v_group text := coalesce(nullif(p->>'group', ''), 'day');
  v_ts timestamptz; v_te timestamptz; v_series jsonb; v_best jsonb; v_tot jsonb;
begin
  perform public.require_admin();
  if v_group not in ('day', 'week', 'month') then raise exception 'Unknown grouping.' using errcode = 'P0001'; end if;
  if v_from > v_to then raise exception 'The start date must be before the end date.' using errcode = 'P0001'; end if;
  if v_to - v_from > 800 then raise exception 'Please choose a shorter date range.' using errcode = 'P0001'; end if;
  v_ts := v_from::timestamp at time zone 'Asia/Kolkata';
  v_te := (v_to + 1)::timestamp at time zone 'Asia/Kolkata';

  select coalesce(jsonb_agg(jsonb_build_object('period', g.period, 'orders', coalesce(a.orders, 0),
           'sales', coalesce(a.sales, 0), 'delivered_sales', coalesce(a.delivered_sales, 0)) order by g.period), '[]'::jsonb)
    into v_series
    from (select d::date as period from generate_series(date_trunc(v_group, v_from::timestamp), v_to::timestamp,
                                                         ('1 ' || v_group)::interval) d) g
    left join (
      select date_trunc(v_group, o.created_at at time zone 'Asia/Kolkata')::date as period,
             count(*) as orders, sum(o.total) as sales, sum(o.total) filter (where o.status = 'delivered') as delivered_sales
        from public.orders o where o.status <> 'cancelled' and o.created_at >= v_ts and o.created_at < v_te group by 1
    ) a on a.period = g.period;

  select coalesce(jsonb_agg(b.j order by b.qty desc), '[]'::jsonb) into v_best from (
    select sum(i.quantity) as qty, jsonb_build_object('product_name', i.product_name, 'quantity', sum(i.quantity),
             'revenue', sum(i.line_total), 'orders', count(distinct i.order_id)) as j
      from public.order_items i join public.orders o on o.id = i.order_id
     where o.status <> 'cancelled' and o.created_at >= v_ts and o.created_at < v_te
     group by i.product_name order by sum(i.quantity) desc, i.product_name limit 10) b;

  select jsonb_build_object(
      'orders', count(*) filter (where status <> 'cancelled'),
      'sales', coalesce(sum(total) filter (where status <> 'cancelled'), 0),
      'cod_orders', count(*) filter (where status <> 'cancelled' and payment_method = 'cod'),
      'delivered_orders', count(*) filter (where status = 'delivered'),
      'delivered_sales', coalesce(sum(total) filter (where status = 'delivered'), 0),
      'cancelled_orders', count(*) filter (where status = 'cancelled'),
      'average_order', coalesce(round(avg(total) filter (where status <> 'cancelled'), 2), 0))
    into v_tot from public.orders where created_at >= v_ts and created_at < v_te;

  return jsonb_build_object('from', v_from, 'to', v_to, 'group', v_group, 'series', v_series, 'best_sellers', v_best, 'totals', v_tot);
end $$;

-- ---------- notification log (admin view) -----------------------------
create or replace function public.admin_list_notifications(p jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_status text := public.nz(p->>'status'); v_limit integer := least(greatest(coalesce((p->>'limit')::integer, 50), 1), 200);
begin
  perform public.require_admin();
  return coalesce((select jsonb_agg(j order by created_at desc) from (
    select n.created_at, jsonb_build_object('id', n.id, 'order_code', o.order_code, 'channel', n.channel,
      'recipient_type', n.recipient_type, 'event', n.event, 'recipient', n.recipient, 'status', n.status,
      'attempts', n.attempts, 'last_error', n.last_error, 'sent_at', n.sent_at, 'created_at', n.created_at) as j
    from public.notification_logs n join public.orders o on o.id = n.order_id
    where v_status is null or n.status = v_status
    order by n.created_at desc limit v_limit) s), '[]'::jsonb);
end $$;

create or replace function public.admin_requeue_notification(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.require_admin();
  update public.notification_logs set status = 'queued', attempts = 0, next_attempt_at = now(), locked_until = null, last_error = null
   where id = p_id and status in ('failed', 'skipped');
  return jsonb_build_object('ok', true);
end $$;
