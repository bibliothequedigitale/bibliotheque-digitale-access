-- Run once in Supabase SQL Editor for Bibliothèque Digitale.
-- Only a user listed in public.admins can call this function.

create or replace function public.admin_user_signins()
returns table (
  user_id uuid,
  email text,
  first_name text,
  account_created_at timestamptz,
  last_sign_in_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  return query
  select
    users.id,
    users.email::text,
    coalesce(users.raw_user_meta_data ->> 'first_name', users.raw_user_meta_data ->> 'name', '')::text,
    users.created_at,
    users.last_sign_in_at
  from auth.users
  order by users.last_sign_in_at desc nulls last;
end;
$$;

revoke all on function public.admin_user_signins() from public;
grant execute on function public.admin_user_signins() to authenticated;
