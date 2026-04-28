-- Enforce mutually exclusive office-role grants so elected executive/chamber seats
-- cannot retain incompatible chamber leadership grants.

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
      and p.office_role is distinct from 'president';
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
      and p.office_role is distinct from 'vice_president';
    return;
  end if;

  if has_rep and has_sen then
    -- Prefer current profile seat when present; default to representative.
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
      and p.office_role is distinct from 'representative';
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
      and p.office_role is distinct from 'senator';
    return;
  end if;
end;
$$;

create or replace function public._normalize_government_role_exclusivity_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._normalize_government_role_exclusivity(new.user_id);
  return new;
end;
$$;

drop trigger if exists trg_normalize_government_role_exclusivity on public.government_role_grants;
create trigger trg_normalize_government_role_exclusivity
after insert on public.government_role_grants
for each row
execute function public._normalize_government_role_exclusivity_trigger();

-- One-time cleanup for existing rows so leadership displays immediately reflect
-- exclusive seat/executive roles.
do $$
declare
  r record;
begin
  for r in
    select distinct g.user_id
    from public.government_role_grants g
    where g.role_key in (
      'president', 'vice_president', 'representative', 'senator',
      'speaker',
      'house_majority_leader', 'house_majority_whip',
      'house_minority_leader', 'house_minority_whip',
      'president_pro_tempore',
      'senate_majority_leader', 'senate_majority_whip',
      'senate_minority_leader', 'senate_minority_whip'
    )
  loop
    perform public._normalize_government_role_exclusivity(r.user_id);
  end loop;
end;
$$;

notify pgrst, 'reload schema';
