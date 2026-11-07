-- =====================================================================
-- Mandal Masala Bhandar  |  03  CUSTOMER-FACING DATABASE FUNCTIONS
-- Prices, stock, delivery charges and totals are ALWAYS calculated here,
-- inside the database, never trusted from the browser.
-- =====================================================================

-- ---------- small helpers (internal) ----------------------------------
-- Turns "+91 98765-43210", "09876543210", "9876543210" into "9876543210". Returns NULL if invalid.
create or replace function public.normalize_phone(p text)
returns text language plpgsql immutable as $$
declare d text := regexp_replace(coalesce(p, ''), '[\s\-().]', '', 'g');
begin
  if    d ~ '^\+91[0-9]{10}$' then d := substr(d, 4);
  elsif d ~ '^91[0-9]{10}$'   then d := substr(d, 3);
  elsif d ~ '^0[0-9]{10}$'    then d := substr(d, 2);
  end if;
  if d ~ '^[6-9][0-9]{9}$' then return d; end if;
  return null;
end $$;

-- Unguessable order code such as MMB-7K3QX9PD (no look-alike letters; crypto-random source).
create or replace function public.make_order_code()
returns text language plpgsql volatile as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  b bytea := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
  out text := '';
begin
  for i in 0..7 loop
    out := out || substr(alphabet, (get_byte(b, i) % 31) + 1, 1);
  end loop;
  return 'MMB-' || out;
end $$;

create or replace function public.order_status_rank(p text)
returns integer language sql immutable as $$
  select case p when 'pending' then 1 when 'confirmed' then 2 when 'processing' then 3
                when 'out_for_delivery' then 4 when 'delivered' then 5 when 'cancelled' then 9 end
$$;

-- Items of an order as JSON (used by several functions).
create or replace function public.order_items_json(p_order uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'product_name', i.product_name, 'variant_label', i.variant_label,
           'unit_price', i.unit_price, 'quantity', i.quantity, 'line_total', i.line_total
         ) order by i.created_at, i.product_name), '[]'::jsonb)
  from public.order_items i where i.order_id = p_order
$$;

-- ---------- catalogue (public) ----------------------------------------
create or replace function public.get_catalog()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with s as (select low_stock_threshold from public.store_settings where id = 1)
  select jsonb_build_object(
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'slug', c.slug,
                                          'description', c.description, 'image_url', c.image_url)
                       order by c.sort_order, c.name)
      from public.categories c where c.is_active), '[]'::jsonb),
    'products', coalesce((
      select jsonb_agg(x.pj order by x.sort_order, x.name)
      from (
        select p.sort_order, p.name,
          jsonb_build_object(
            'id', p.id, 'category_id', p.category_id, 'name', p.name, 'slug', p.slug,
            'short_description', p.short_description, 'description', p.description,
            'image_url', p.image_url, 'is_featured', p.is_featured, 'is_best_seller', p.is_best_seller,
            'variants', coalesce((
              select jsonb_agg(jsonb_build_object(
                       'id', v.id, 'label', v.label, 'price', v.price,
                       'compare_at_price', v.compare_at_price, 'in_stock', v.in_stock,
                       'low_stock', (v.in_stock and v.stock_qty <= (select low_stock_threshold from s)))
                     order by v.sort_order, v.price)
              from public.product_variants v where v.product_id = p.id), '[]'::jsonb)
          ) as pj
        from public.products p
        join public.categories c on c.id = p.category_id and c.is_active
        where p.is_active
      ) x), '[]'::jsonb)
  )
$$;

-- ---------- shop details + delivery areas (public) --------------------
create or replace function public.get_store_info()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select to_jsonb(s) - 'id' - 'low_stock_threshold' - 'updated_at'
         || jsonb_build_object('delivery_zones', coalesce((
              select jsonb_agg(jsonb_build_object(
                       'name', z.name, 'pin_codes', z.pin_codes, 'delivery_charge', z.delivery_charge,
                       'min_order_value', z.min_order_value,
                       'free_delivery_threshold', z.free_delivery_threshold) order by z.name)
              from public.delivery_zones z where z.is_active), '[]'::jsonb))
  from public.store_settings s where s.id = 1
$$;

-- ---------- can we deliver to this PIN, and what would it cost? -------
create or replace function public.check_delivery(p_pin text, p_subtotal numeric default 0)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare z public.delivery_zones; v_pin text := btrim(coalesce(p_pin, '')); v_sub numeric := greatest(coalesce(p_subtotal, 0), 0);
begin
  if v_pin !~ '^[1-9][0-9]{5}$' then
    return jsonb_build_object('deliverable', false, 'message', 'Please enter a valid 6-digit PIN code.');
  end if;
  select * into z from public.delivery_zones where is_active and v_pin = any(pin_codes) limit 1;
  if not found then
    return jsonb_build_object('deliverable', false,
      'message', 'Sorry, we do not deliver to PIN code ' || v_pin || ' yet.');
  end if;
  return jsonb_build_object(
    'deliverable', true, 'zone_name', z.name,
    'delivery_charge', case when z.free_delivery_threshold is not null and v_sub >= z.free_delivery_threshold
                            then 0 else z.delivery_charge end,
    'base_charge', z.delivery_charge,
    'min_order_value', z.min_order_value,
    'free_delivery_threshold', z.free_delivery_threshold,
    'meets_minimum', v_sub >= z.min_order_value);
end $$;

-- ---------- PLACE AN ORDER --------------------------------------------
-- Input (JSON): { idempotency_key, expected_total?, customer:{name,phone,email?,address,locality,city,state,pin,notes?},
--                 items:[{variant_id, quantity}] }
-- Any prices sent by the browser are ignored. 'expected_total' is only a safety check:
-- if the real total differs, the order is refused and the customer is asked to review.
create or replace function public.place_order(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_key uuid; c jsonb; v_name text; v_phone text; v_email text; v_addr text; v_loc text; v_city text;
  v_state text; v_pin text; v_notes text; v_expected numeric;
  v_item jsonb; v_vids uuid[] := '{}'; v_qtys integer[] := '{}'; v_vid uuid; v_qty integer;
  r record; v_lines jsonb := '[]'::jsonb; v_distinct integer; v_subtotal numeric(12,2) := 0;
  z public.delivery_zones; v_charge numeric(10,2); v_total numeric(12,2);
  v_existing public.orders; o_id uuid; v_code text; v_created timestamptz;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Invalid order.' using errcode = 'P0001';
  end if;

  -- 1. idempotency: the same checkout submitted twice returns the SAME order
  begin
    v_key := (p->>'idempotency_key')::uuid;
  exception when others then
    raise exception 'Invalid order reference. Please reload the page and try again.' using errcode = 'P0001';
  end;
  if v_key is null then
    raise exception 'Invalid order reference. Please reload the page and try again.' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_key::text, 0));
  select * into v_existing from public.orders where idempotency_key = v_key;
  if found then
    return jsonb_build_object('order_code', v_existing.order_code, 'status', v_existing.status,
      'subtotal', v_existing.subtotal, 'delivery_charge', v_existing.delivery_charge, 'total', v_existing.total,
      'delivery_zone_name', v_existing.delivery_zone_name, 'created_at', v_existing.created_at,
      'items', public.order_items_json(v_existing.id), 'duplicate', true);
  end if;

  -- 2. validate customer details
  c := coalesce(p->'customer', '{}'::jsonb);
  if jsonb_typeof(c) <> 'object' then c := '{}'::jsonb; end if;
  v_name  := btrim(coalesce(c->>'name', ''));
  v_phone := public.normalize_phone(c->>'phone');
  v_email := nullif(btrim(coalesce(c->>'email', '')), '');
  v_addr  := btrim(coalesce(c->>'address', ''));
  v_loc   := btrim(coalesce(c->>'locality', ''));
  v_city  := btrim(coalesce(c->>'city', ''));
  v_state := btrim(coalesce(c->>'state', ''));
  v_pin   := btrim(coalesce(c->>'pin', ''));
  v_notes := nullif(btrim(coalesce(c->>'notes', '')), '');

  if char_length(v_name) < 2 or char_length(v_name) > 80 then
    raise exception 'Please enter your full name.' using errcode = 'P0001', hint = 'name';
  end if;
  if v_phone is null then
    raise exception 'Please enter a valid 10-digit Indian mobile number.' using errcode = 'P0001', hint = 'phone';
  end if;
  if v_email is not null and (v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 120) then
    raise exception 'Please enter a valid email address, or leave it empty.' using errcode = 'P0001', hint = 'email';
  end if;
  if char_length(v_addr) < 8 or char_length(v_addr) > 300 then
    raise exception 'Please enter your full delivery address (house, street, landmark).' using errcode = 'P0001', hint = 'address';
  end if;
  if char_length(v_loc) < 2 or char_length(v_loc) > 100 then
    raise exception 'Please enter your locality or area.' using errcode = 'P0001', hint = 'locality';
  end if;
  if char_length(v_city) < 2 or char_length(v_city) > 60 then
    raise exception 'Please enter your city or town.' using errcode = 'P0001', hint = 'city';
  end if;
  if char_length(v_state) < 2 or char_length(v_state) > 60 then
    raise exception 'Please enter your state.' using errcode = 'P0001', hint = 'state';
  end if;
  if v_pin !~ '^[1-9][0-9]{5}$' then
    raise exception 'Please enter a valid 6-digit PIN code.' using errcode = 'P0001', hint = 'pin';
  end if;
  if v_notes is not null and char_length(v_notes) > 500 then
    raise exception 'Order notes are too long (500 characters maximum).' using errcode = 'P0001', hint = 'notes';
  end if;
  begin
    v_expected := nullif(p->>'expected_total', '')::numeric;
  exception when others then
    v_expected := null;
  end;

  -- 3. validate items (only IDs and quantities are read from the browser)
  if coalesce(jsonb_typeof(p->'items'), '') <> 'array' or jsonb_array_length(p->'items') not between 1 and 50 then
    raise exception 'Your cart is empty.' using errcode = 'P0001', hint = 'cart';
  end if;
  for v_item in select * from jsonb_array_elements(p->'items') loop
    begin
      v_vid := (v_item->>'variant_id')::uuid;
      v_qty := (v_item->>'quantity')::integer;
    exception when others then
      raise exception 'Your cart has an invalid item. Please refresh the page.' using errcode = 'P0001', hint = 'cart';
    end;
    if v_vid is null or v_qty is null or v_qty < 1 or v_qty > 100 then
      raise exception 'Each item quantity must be between 1 and 100.' using errcode = 'P0001', hint = 'cart';
    end if;
    v_vids := v_vids || v_vid;
    v_qtys := v_qtys || v_qty;
  end loop;
  select count(distinct x) into v_distinct from unnest(v_vids) x;

  -- 4. lock the variants (fixed order => no deadlocks), check stock, price from the DATABASE
  for r in
    select v.id, v.label, v.price, v.stock_qty, v.is_available,
           p2.id as product_id, p2.name as product_name, p2.is_active as p_active, c2.is_active as c_active, q.qty
    from (select t.vid, sum(t.q)::integer as qty from unnest(v_vids, v_qtys) as t(vid, q) group by t.vid) q
    join public.product_variants v on v.id = q.vid
    join public.products p2 on p2.id = v.product_id
    join public.categories c2 on c2.id = p2.category_id
    order by v.id
    for update of v
  loop
    if not (r.p_active and r.c_active and r.is_available) then
      raise exception '% (%) is not available right now. Please remove it from your cart.', r.product_name, r.label
        using errcode = 'P0001', hint = 'unavailable';
    end if;
    if r.stock_qty < r.qty then
      if r.stock_qty = 0 then
        raise exception '% (%) is out of stock. Please remove it from your cart.', r.product_name, r.label
          using errcode = 'P0001', hint = 'out_of_stock';
      end if;
      raise exception 'Only % of % (%) left in stock. Please reduce the quantity.', r.stock_qty, r.product_name, r.label
        using errcode = 'P0001', hint = 'out_of_stock';
    end if;
    v_lines := v_lines || jsonb_build_object('variant_id', r.id, 'product_id', r.product_id,
      'product_name', r.product_name, 'variant_label', r.label, 'unit_price', r.price, 'quantity', r.qty);
    v_subtotal := v_subtotal + (r.price * r.qty);
  end loop;
  if jsonb_array_length(v_lines) <> v_distinct then
    raise exception 'Some items in your cart are no longer available. Please refresh the page.'
      using errcode = 'P0001', hint = 'unavailable';
  end if;

  -- 5. delivery area, minimum order, delivery charge (all from delivery_zones)
  select * into z from public.delivery_zones where is_active and v_pin = any(pin_codes) limit 1;
  if not found then
    raise exception 'Sorry, we do not deliver to PIN code % yet.', v_pin using errcode = 'P0001', hint = 'pin';
  end if;
  if v_subtotal < z.min_order_value then
    raise exception 'The minimum order for your area is Rs. %. Please add more items.', trim(to_char(z.min_order_value, 'FM999999990.00'))
      using errcode = 'P0001', hint = 'min_order';
  end if;
  v_charge := case when z.free_delivery_threshold is not null and v_subtotal >= z.free_delivery_threshold
                   then 0 else z.delivery_charge end;
  v_total := v_subtotal + v_charge;

  if v_expected is not null and v_expected <> v_total then
    raise exception 'Prices or delivery charges have changed. The correct total is Rs. %. Please review and place the order again.',
      trim(to_char(v_total, 'FM999999990.00')) using errcode = 'P0001', hint = 'price_changed';
  end if;

  -- 6. basic abuse guard
  if (select count(*) from public.orders where customer_phone = v_phone and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Too many orders were placed with this mobile number in the last hour. Please call the shop.'
      using errcode = 'P0001', hint = 'rate_limit';
  end if;

  -- 7. save the order (retry on the very rare order-code clash)
  for i in 1..6 loop
    v_code := public.make_order_code();
    begin
      insert into public.orders (order_code, idempotency_key, status, customer_name, customer_phone, customer_email,
                                 address_line, locality, city, state, pin_code, notes,
                                 delivery_zone_id, delivery_zone_name, subtotal, delivery_charge, total)
      values (v_code, v_key, 'pending', v_name, v_phone, v_email, v_addr, v_loc, v_city, v_state, v_pin, v_notes,
              z.id, z.name, v_subtotal, v_charge, v_total)
      returning id, created_at into o_id, v_created;
      exit;
    exception when unique_violation then
      if i = 6 then raise; end if;
    end;
  end loop;

  insert into public.order_items (order_id, variant_id, product_id, product_name, variant_label, unit_price, quantity, line_total)
  select o_id, (l->>'variant_id')::uuid, (l->>'product_id')::uuid, l->>'product_name', l->>'variant_label',
         (l->>'unit_price')::numeric, (l->>'quantity')::integer, (l->>'unit_price')::numeric * (l->>'quantity')::integer
  from jsonb_array_elements(v_lines) l;

  -- 8. take the stock (rows are locked, and stock_qty has a >= 0 check as a final safety net)
  update public.product_variants v
     set stock_qty = v.stock_qty - (l->>'quantity')::integer
    from jsonb_array_elements(v_lines) l
   where v.id = (l->>'variant_id')::uuid;

  insert into public.order_status_history (order_id, from_status, to_status, note)
  values (o_id, null, 'pending', 'Order placed by customer');

  -- 9. queue notifications (they are sent later; failures can never undo the order)
  perform public.enqueue_notifications(o_id, 'order_placed');

  return jsonb_build_object('order_code', v_code, 'status', 'pending', 'subtotal', v_subtotal,
    'delivery_charge', v_charge, 'total', v_total, 'delivery_zone_name', z.name, 'created_at', v_created,
    'items', public.order_items_json(o_id), 'duplicate', false);
end $$;

-- ---------- CUSTOMER ORDER TRACKING -----------------------------------
-- Needs BOTH the order code and the mobile number used at checkout.
create or replace function public.track_order(p_code text, p_phone text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_code text := upper(btrim(coalesce(p_code, ''))); v_phone text := public.normalize_phone(p_phone); o public.orders;
begin
  if char_length(v_code) < 6 or char_length(v_code) > 20 then
    raise exception 'Please enter your order ID (for example MMB-7K3QX9PD).' using errcode = 'P0001';
  end if;
  if v_phone is null then
    raise exception 'Please enter the 10-digit mobile number used for the order.' using errcode = 'P0001';
  end if;
  if random() < 0.02 then
    delete from public.tracking_attempts where created_at < now() - interval '1 day';
  end if;
  if (select count(*) from public.tracking_attempts
       where order_code = v_code and created_at > now() - interval '15 minutes') >= 8 then
    raise exception 'Too many attempts. Please wait a few minutes and try again.' using errcode = 'P0001';
  end if;

  select * into o from public.orders where order_code = v_code and customer_phone = v_phone;
  if not found then
    insert into public.tracking_attempts (order_code) values (left(v_code, 20));
    return jsonb_build_object('found', false);   -- same answer whether the code exists or not
  end if;

  return jsonb_build_object(
    'found', true, 'order_code', o.order_code, 'status', o.status, 'created_at', o.created_at,
    'customer_name', o.customer_name,
    'address', o.address_line || ', ' || o.locality || ', ' || o.city || ', ' || o.state || ' ' || o.pin_code,
    'subtotal', o.subtotal, 'delivery_charge', o.delivery_charge, 'total', o.total,
    'payment_method', o.payment_method,
    'items', public.order_items_json(o.id),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('status', h.to_status, 'at', h.changed_at) order by h.changed_at, h.id), '[]'::jsonb)
                from public.order_status_history h where h.order_id = o.id));
end $$;
