-- Fix: role exclusivity normalizer must never strip or overwrite admin/staff admin identity.
-- Preserve staff operators and repair admin grants/profile role consistency.

create or replace function public._normalize_government_role_exclusivity(p_uid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  has_president boolean := false;
  has_vp boolean := false;
  has_rep boolean := false;
  has_sen boolean := false;
  is_staff boolean := false;
  house_leadership text[] := array[
    'speaker',
    'house_majority_leader',
    'house_majority_whip',
    'house_minority_leader',
    'house_minority_whip'
  ];
  senate_leadership text[] := array[
    'president_pro_tempore',
    'senate_majority_leader',
    'senate_majority_whip',
    'senate_minority_leader',
    'senate_minority_whip'
  ];
begin
  if p_uid is null then
    return;
  end if;

  select public.is_staff_admin(p_uid) into is_staff;
  if is_staff then
    -- Staff/admin operators are exempt from exclusivity pruning.
    -- Keep their canonical office marker for legacy checks.
    update public.profiles p
    set office_role = 'admin',
        updated_at = now()
    where p.id = p_uid
      and p.office_role is distinct from 'admin';
    insert into public.government_role_grants (user_id, role_key)
    values (p_uid, 'admin')
    on conflict (user_id, role_key) do nothing;
    return;
  end if;

  select exists(
    select 1 from public.government_role_grants g where g.user_id = p_uid and g.role_key = 'president'
  ) into has_president;
  select exists(
    select 1 from public.government_role_grants g where g.user_id = p_uid and g.role_key = 'vice_president'
  ) into has_vp;
  select exists(
    select 1 from public.government_role_grants g where g.user_id = p_uid and g.role_key = 'representative'
  ) into has_rep;
  select exists(
    select 1 from public.government_role_grants g where g.user_id = p_uid and g.role_key = 'senator'
  ) into has_sen;

  if has_president then
    delete from public.government_role_grants g
    where g.user_id = p_uid
      and g.role_key = any(
        array_cat(
          array['vice_president', 'representative', 'senator']::text[],
          array_cat(house_leadership, senate_leadership)
        )
      );
    update public.profiles p
    set office_role = 'president',
        updated_at = now()
    where p.id = p_uid
      and p.office_role is distinct from 'president'
      and p.office_role is distinct from 'admin';
    return;
  end if;

  if has_vp then
    delete from public.government_role_grants g
    where g.user_id = p_uid
      and g.role_key = any(
        array_cat(
          array['president', 'representative', 'senator']::text[],
          array_cat(house_leadership, senate_leadership)
        )
      );
    update public.profiles p
    set office_role = 'vice_president',
        updated_at = now()
    where p.id = p_uid
      and p.office_role is distinct from 'vice_president'
      and p.office_role is distinct from 'admin';
    return;
  end if;

  if has_rep and has_sen then
    if exists(
      select 1 from public.profiles p
      where p.id = p_uid and p.office_role = 'senator'
    ) then
      delete from public.government_role_grants g
      where g.user_id = p_uid and g.role_key = 'representative';
      has_rep := false;
    else
      delete from public.government_role_grants g
      where g.user_id = p_uid and g.role_key = 'senator';
      has_sen := false;
    end if;
  end if;

  if has_rep then
    delete from public.government_role_grants g
    where g.user_id = p_uid
      and g.role_key = any(array_cat(array['president', 'vice_president', 'senator']::text[], senate_leadership));
    update public.profiles p
    set office_role = 'representative',
        updated_at = now()
    where p.id = p_uid
      and p.office_role in ('president', 'vice_president', 'senator')
      and p.office_role is distinct from 'representative'
      and p.office_role is distinct from 'admin';
    return;
  end if;

  if has_sen then
    delete from public.government_role_grants g
    where g.user_id = p_uid
      and g.role_key = any(array_cat(array['president', 'vice_president', 'representative']::text[], house_leadership));
    update public.profiles p
    set office_role = 'senator',
        updated_at = now()
    where p.id = p_uid
      and p.office_role in ('president', 'vice_president', 'representative')
      and p.office_role is distinct from 'senator'
      and p.office_role is distinct from 'admin';
    return;
  end if;
end;
$$;

-- Repair path: if a profile is marked admin, ensure an admin grant exists.
insert into public.government_role_grants (user_id, role_key)
select p.id, 'admin'
from public.profiles p
where p.office_role = 'admin'
on conflict (user_id, role_key) do nothing;

-- Repair path: if a user is staff-admin by grant, keep the legacy profile marker too.
update public.profiles p
set office_role = 'admin',
    updated_at = now()
where p.id in (
  select g.user_id
  from public.government_role_grants g
  where g.role_key in ('admin', 'staff_super')
)
and p.office_role is distinct from 'admin';

notify pgrst, 'reload schema';
