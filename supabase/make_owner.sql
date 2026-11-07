-- Mandal Masala Bhandar: make ONE person the shop owner (the only person who can use /admin).
--
-- Do this AFTER you ran setup.sql:
--   1. Supabase dashboard -> Authentication -> Users -> "Add user" -> "Create new user".
--      Type the owner's email and a strong password, and tick "Auto Confirm User".
--   2. Replace owner@example.com below with that same email, then run this in the SQL Editor.
--
-- There is deliberately no button on the website that can do this, so nobody can make
-- themselves an owner from the browser.

insert into public.profiles (id, full_name, role, is_active)
select id, 'Shop Owner', 'owner', true
from auth.users
where email = 'owner@example.com'          -- <-- CHANGE THIS to the owner's email
on conflict (id) do update set is_active = true, role = 'owner';

-- Check: this should show exactly one row.
select p.id, u.email, p.role, p.is_active
from public.profiles p join auth.users u on u.id = p.id;
