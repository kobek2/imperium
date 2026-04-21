-- Allow `staff_super` grant to satisfy the same RLS paths as `admin` (full operator without reusing the `admin` key).

create or replace function public.is_staff_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = uid and p.office_role = 'admin'
  )
  or exists (
    select 1 from public.government_role_grants g
    where g.user_id = uid and g.role_key in ('admin', 'staff_super')
  );
$$;

comment on function public.is_staff_admin(uuid) is
  'True for legacy profiles.office_role admin, or grants admin / staff_super. Granular staff_* keys are enforced in app code until per-resource policies exist.';
