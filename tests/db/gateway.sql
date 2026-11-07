-- TEST-ONLY stand-in for Supabase's "call a database function over HTTP" feature (PostgREST /rpc).
-- It runs the function as the CALLER's role, so all permission checks are real.
create schema if not exists testgw;
create or replace function testgw.rpc(fn text, args jsonb default '{}'::jsonb)
returns jsonb language plpgsql as $$
declare pr record; parts text[] := '{}'; res jsonb; i integer;
begin
  select p.proargnames as names, p.proargtypes::oid[] as types into pr
    from pg_proc p where p.proname = fn and p.pronamespace = 'public'::regnamespace
     and p.prokind = 'f' limit 1;
  if not found then raise exception 'function % not found', fn using errcode = '42883'; end if;
  for i in 1..coalesce(array_length(pr.names, 1), 0) loop
    if args ? pr.names[i] and jsonb_typeof(args -> pr.names[i]) <> 'null' then
      parts := parts || format('%I := %L::%s', pr.names[i],
         case when format_type(pr.types[i-1], null) = 'jsonb' then (args -> pr.names[i])::text else args ->> pr.names[i] end,
         format_type(pr.types[i-1], null));
    end if;
  end loop;
  execute format('select to_jsonb(public.%I(%s))', fn, array_to_string(parts, ', ')) into res;
  return res;
end $$;
grant usage on schema testgw to anon, authenticated, service_role;
grant execute on function testgw.rpc(text, jsonb) to anon, authenticated, service_role;
