-- Repair private Storage access for approved Bibliotheque Digitale customers.
-- Safe to run more than once in the Supabase SQL Editor.

create or replace function public.can_access_product_file(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public, storage, pg_temp
as $$
  select
    public.is_admin()
    or exists (
      select 1
      from public.user_products
      join public.products on products.id = user_products.product_id
      where user_products.user_id = auth.uid()
        and products.slug = (storage.foldername(object_name))[1]
    );
$$;

revoke all on function public.can_access_product_file(text) from public;
grant execute on function public.can_access_product_file(text) to authenticated;

drop policy if exists "Approved users can read product files" on storage.objects;
create policy "Approved users can read product files"
on storage.objects for select
to authenticated
using (
  bucket_id = 'product-files'
  and public.can_access_product_file(name)
);
