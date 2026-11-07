-- =====================================================================
-- Mandal Masala Bhandar  |  07  WHO MAY CALL WHICH FUNCTION
-- Run LAST. Closes every function, then opens exactly what is needed.
-- =====================================================================
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prokind = 'f'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

-- customers (anonymous visitors)
grant execute on function public.get_catalog()                   to anon, authenticated;
grant execute on function public.get_store_info()                to anon, authenticated;
grant execute on function public.check_delivery(text, numeric)   to anon, authenticated;
grant execute on function public.place_order(jsonb)              to anon, authenticated;
grant execute on function public.track_order(text, text)         to anon, authenticated;
grant execute on function public.is_admin()                      to anon, authenticated;

-- shop owner (each function ALSO checks is_admin() inside)
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'admin\_%'
  loop
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

-- notification worker (Edge Function uses the service role)
grant execute on function public.claim_notifications(integer)                          to service_role;
grant execute on function public.finish_notification(uuid, text, text, text, boolean)  to service_role;
