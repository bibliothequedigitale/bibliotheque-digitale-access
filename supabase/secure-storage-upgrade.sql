-- Secure product file storage upgrade
-- Run this in Supabase SQL Editor if you already created the database schema.

insert into storage.buckets (id, name, public)
values ('product-files', 'product-files', false)
on conflict (id) do update set public = false;

drop policy if exists "Approved users can read product files" on storage.objects;
create policy "Approved users can read product files"
on storage.objects for select
to authenticated
using (
  bucket_id = 'product-files'
  and (
    public.is_admin()
    or exists (
      select 1
      from public.products
      join public.user_products on user_products.product_id = products.id
      where products.slug = (storage.foldername(name))[1]
        and user_products.user_id = auth.uid()
    )
  )
);

drop policy if exists "Admins can upload product files" on storage.objects;
create policy "Admins can upload product files"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'product-files'
  and public.is_admin()
);

drop policy if exists "Admins can update product files" on storage.objects;
create policy "Admins can update product files"
on storage.objects for update
to authenticated
using (
  bucket_id = 'product-files'
  and public.is_admin()
)
with check (
  bucket_id = 'product-files'
  and public.is_admin()
);
