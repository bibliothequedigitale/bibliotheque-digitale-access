-- Bibliotheque Digitale access system
-- Run this in Supabase SQL Editor after creating a fresh Supabase project.

create extension if not exists pgcrypto;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  short_description text,
  status text not null default 'active' check (status in ('active', 'coming_soon', 'archived')),
  display_order integer not null default 100,
  created_at timestamptz not null default now()
);

create table if not exists public.user_products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  source text not null default 'manual',
  source_reference text,
  granted_by uuid references auth.users(id),
  granted_at timestamptz not null default now(),
  unique (user_id, product_id)
);

create table if not exists public.access_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  customer_email text not null default '',
  product_id uuid not null references public.products(id) on delete cascade,
  etsy_order_number text not null,
  etsy_buyer_info text not null,
  notes text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  created_at timestamptz not null default now()
);

insert into public.products (slug, name, short_description, status, display_order)
values
  (
    'branding-planner-plr',
    'Branding Planner & Workbook PLR',
    'A4, A5, and US Letter planner files with bonus strategy resources.',
    'active',
    1
  ),
  (
    'faceless-photo-pack',
    'Faceless Photo Pack',
    'Coming soon. This product will unlock here after purchase.',
    'coming_soon',
    2
  )
on conflict (slug) do update set
  name = excluded.name,
  short_description = excluded.short_description,
  status = excluded.status,
  display_order = excluded.display_order;

alter table public.products enable row level security;
alter table public.user_products enable row level security;
alter table public.access_requests enable row level security;
alter table public.admins enable row level security;

grant usage on schema public to anon, authenticated;
grant select on public.products to authenticated;
grant select, insert, update on public.access_requests to authenticated;
grant select, insert, update on public.user_products to authenticated;
grant select on public.admins to authenticated;

insert into storage.buckets (id, name, public)
values ('product-files', 'product-files', false)
on conflict (id) do update set public = false;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admins
    where admins.user_id = auth.uid()
  );
$$;

drop policy if exists "Products are readable by signed-in users" on public.products;
create policy "Products are readable by signed-in users"
on public.products for select
to authenticated
using (true);

drop policy if exists "Users can read their own access" on public.user_products;
create policy "Users can read their own access"
on public.user_products for select
to authenticated
using (user_id = auth.uid() or public.is_admin());

drop policy if exists "Admins can grant access" on public.user_products;
create policy "Admins can grant access"
on public.user_products for insert
to authenticated
with check (public.is_admin());

drop policy if exists "Admins can update access" on public.user_products;
create policy "Admins can update access"
on public.user_products for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Users can create their own access requests" on public.access_requests;
create policy "Users can create their own access requests"
on public.access_requests for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "Users can read their own access requests" on public.access_requests;
create policy "Users can read their own access requests"
on public.access_requests for select
to authenticated
using (user_id = auth.uid() or public.is_admin());

drop policy if exists "Admins can review access requests" on public.access_requests;
create policy "Admins can review access requests"
on public.access_requests for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Admins can read admins" on public.admins;
create policy "Admins can read admins"
on public.admins for select
to authenticated
using (public.is_admin());

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

-- After creating your admin account in the app, run this with your actual auth user id.
-- You can find the user id in Supabase Authentication > Users.
--
-- insert into public.admins (user_id, email)
-- values ('PASTE_YOUR_AUTH_USER_ID_HERE', 'bibliotheque.digitale.etsy@gmail.com')
-- on conflict (user_id) do nothing;
