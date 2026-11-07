-- =====================================================================
-- Mandal Masala Bhandar  |  06  PRODUCT IMAGE STORAGE (Supabase only)
-- Public can VIEW product photos. Only the signed-in owner can upload/replace/delete.
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 2097152,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "product images are public" on storage.objects;
create policy "product images are public" on storage.objects
  for select using (bucket_id = 'product-images');

drop policy if exists "owner uploads product images" on storage.objects;
create policy "owner uploads product images" on storage.objects
  for insert to authenticated with check (bucket_id = 'product-images' and public.is_admin());

drop policy if exists "owner replaces product images" on storage.objects;
create policy "owner replaces product images" on storage.objects
  for update to authenticated using (bucket_id = 'product-images' and public.is_admin())
  with check (bucket_id = 'product-images' and public.is_admin());

drop policy if exists "owner deletes product images" on storage.objects;
create policy "owner deletes product images" on storage.objects
  for delete to authenticated using (bucket_id = 'product-images' and public.is_admin());
