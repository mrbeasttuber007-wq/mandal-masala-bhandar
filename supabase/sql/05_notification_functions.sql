-- =====================================================================
-- Mandal Masala Bhandar  |  05  NOTIFICATION QUEUE (outbox)
-- Orders are saved first. Messages are queued here and sent afterwards by
-- the "notifications" Edge Function, with retries and a full log.
-- =====================================================================

-- Queue the messages for one order event, following the owner's settings.
create or replace function public.enqueue_notifications(p_order_id uuid, p_event text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.notification_settings; o public.orders;
begin
  select * into s from public.notification_settings where id = 1;
  select * into o from public.orders where id = p_order_id;
  if s.id is null or o.id is null then return; end if;

  if p_event = 'order_placed' then
    if s.owner_email_enabled then
      insert into public.notification_logs (order_id, channel, recipient_type, event, recipient, status, last_error)
      values (o.id, 'email', 'owner', p_event, s.owner_email,
              case when s.owner_email is null then 'skipped' else 'queued' end,
              case when s.owner_email is null then 'Owner email is not set in Notification Settings.' end)
      on conflict do nothing;
    end if;
    if s.owner_whatsapp_enabled then
      insert into public.notification_logs (order_id, channel, recipient_type, event, recipient, status, last_error)
      values (o.id, 'whatsapp', 'owner', p_event, case when s.owner_whatsapp is not null then '91' || s.owner_whatsapp end,
              case when s.owner_whatsapp is null then 'skipped' else 'queued' end,
              case when s.owner_whatsapp is null then 'Owner WhatsApp number is not set in Notification Settings.' end)
      on conflict do nothing;
    end if;
  end if;

  if s.customer_email_enabled and o.customer_email is not null then
    insert into public.notification_logs (order_id, channel, recipient_type, event, recipient)
    values (o.id, 'email', 'customer', p_event, o.customer_email) on conflict do nothing;
  end if;
  if s.customer_whatsapp_enabled then
    insert into public.notification_logs (order_id, channel, recipient_type, event, recipient)
    values (o.id, 'whatsapp', 'customer', p_event, '91' || o.customer_phone) on conflict do nothing;
  end if;
end $$;

-- ---- used ONLY by the Edge Function (service role) --------------------

-- Take up to p_limit due messages, mark them 'sending' (2-minute lease) and return everything needed to send them.
create or replace function public.claim_notifications(p_limit integer default 10)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare ids uuid[]; s jsonb; st public.store_settings;
begin
  select * into st from public.store_settings where id = 1;
  select to_jsonb(n) - 'id' - 'updated_at' into s from public.notification_settings n where n.id = 1;
  s := coalesce(s, '{}'::jsonb) || jsonb_build_object('shop_name', st.shop_name, 'shop_phone', st.contact_phone,
         'shop_address', st.address, 'shop_email', st.contact_email);

  with c as (
    select id from public.notification_logs
     where attempts < 5 and (
             (status in ('queued', 'failed') and next_attempt_at <= now())
          or (status = 'sending' and locked_until < now()))
     order by created_at limit greatest(least(p_limit, 25), 1)
     for update skip locked),
  u as (
    update public.notification_logs n
       set status = 'sending', attempts = n.attempts + 1, locked_until = now() + interval '2 minutes'
      from c where n.id = c.id
    returning n.id)
  select array_agg(id) into ids from u;

  return jsonb_build_object('settings', s, 'messages', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', n.id, 'channel', n.channel, 'recipient_type', n.recipient_type, 'event', n.event,
      'recipient', n.recipient, 'attempts', n.attempts,
      'order', jsonb_build_object('order_code', o.order_code, 'status', o.status, 'customer_name', o.customer_name,
         'customer_phone', o.customer_phone, 'customer_email', o.customer_email,
         'address', o.address_line || ', ' || o.locality || ', ' || o.city || ', ' || o.state || ' ' || o.pin_code,
         'notes', o.notes, 'subtotal', o.subtotal, 'delivery_charge', o.delivery_charge, 'total', o.total,
         'created_at', o.created_at, 'items', public.order_items_json(o.id))) order by n.created_at)
    from public.notification_logs n join public.orders o on o.id = n.order_id
    where n.id = any(coalesce(ids, '{}'))), '[]'::jsonb));
end $$;

-- Record the result of one send attempt.
-- p_outcome: 'sent' | 'failed' | 'skipped'.  p_permanent: do not retry (for example a rejected phone number).
create or replace function public.finish_notification(p_id uuid, p_outcome text, p_error text default null,
                                                      p_provider_id text default null, p_permanent boolean default false)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_outcome = 'sent' then
    update public.notification_logs set status = 'sent', sent_at = now(), locked_until = null, last_error = null,
           provider_message_id = left(p_provider_id, 200) where id = p_id;
  elsif p_outcome = 'skipped' then
    update public.notification_logs set status = 'skipped', locked_until = null, last_error = left(p_error, 500) where id = p_id;
  else
    update public.notification_logs set status = 'failed', locked_until = null, last_error = left(p_error, 500),
           attempts = case when p_permanent then greatest(attempts, 5) else attempts end,
           next_attempt_at = now() + (power(2, least(attempts, 6)) * interval '30 seconds')
     where id = p_id;
  end if;
end $$;
