-- When a player changes residence state or home congressional district, apply penalties and
-- vacate incompatible chamber roles. Executive / SCOTUS / cabinet appointees are exempt.
-- Keep role list aligned with web/src/lib/geographic-move.ts (GEOGRAPHIC_MOVE_EXEMPT_ROLE_KEYS).

create or replace function public.apply_profile_geographic_move(
  p_new_residence_state text,
  p_new_home_district text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  old_st text;
  old_dist text;
  new_st text;
  new_dist text;
  state_changed boolean;
  dist_changed boolean;
  exempt boolean := false;
  orole text;
  house_strip text[] := array[
    'representative',
    'speaker',
    'house_majority_leader',
    'house_majority_whip',
    'house_minority_leader',
    'house_minority_whip',
    'house_deputy'
  ]::text[];
  senate_strip text[] := array[
    'senator',
    'president_pro_tempore',
    'senate_majority_leader',
    'senate_majority_whip',
    'senate_minority_leader',
    'senate_minority_whip',
    'senate_deputy'
  ]::text[];
  exempt_keys text[] := array[
    'president',
    'vice_president',
    'cabinet',
    'chief_justice',
    'associate_justice',
    'chief_of_staff',
    'secretary_of_state',
    'secretary_of_treasury',
    'attorney_general',
    'secretary_of_defense',
    'secretary_of_homeland_security',
    'secretary_of_health_and_human_services',
    'secretary_of_transportation',
    'secretary_of_energy',
    'secretary_of_interior',
    'secretary_of_agriculture',
    'secretary_of_commerce',
    'secretary_of_education',
    'secretary_of_veterans_affairs',
    'secretary_of_housing_and_urban_development'
  ]::text[];
  strip_union text[];
begin
  if v_uid is null then
    return jsonb_build_object('error', 'not_authenticated');
  end if;

  new_st := upper(trim(coalesce(p_new_residence_state, '')));
  new_dist := upper(trim(coalesce(p_new_home_district, '')));

  if length(new_st) <> 2 or new_dist = '' then
    return jsonb_build_object('error', 'invalid_new_geography');
  end if;

  select
    upper(trim(coalesce(p.residence_state, ''))),
    upper(trim(coalesce(p.home_district_code, ''))),
    p.office_role
  into old_st, old_dist, orole
  from public.profiles p
  where p.id = v_uid
  for update;

  if not found then
    return jsonb_build_object('error', 'no_profile');
  end if;

  state_changed := old_st is distinct from new_st;
  dist_changed := old_dist is distinct from new_dist;

  if not state_changed and not dist_changed then
    return jsonb_build_object('applied', false, 'reason', 'no_geographic_change');
  end if;

  exempt := coalesce(orole, '') = any(exempt_keys)
    or exists (
      select 1
      from public.government_role_grants g
      where g.user_id = v_uid
        and g.role_key = any(exempt_keys)
    );

  if exempt then
    return jsonb_build_object('applied', false, 'reason', 'exempt');
  end if;

  perform public.apply_profile_approval_delta(
    v_uid,
    -10::numeric,
    'Relocated (changed home state or congressional district)'
  );

  strip_union := array[]::text[];

  if state_changed or dist_changed then
    strip_union := strip_union || house_strip;
  end if;

  if state_changed then
    strip_union := strip_union || senate_strip;
  end if;

  if array_length(strip_union, 1) is not null then
    delete from public.government_role_grants g
    where g.user_id = v_uid
      and g.role_key = any(strip_union);
  end if;

  update public.profiles p
  set
    office_role = case
      when p.office_role = any(strip_union) then null
      else p.office_role
    end,
    updated_at = now()
  where p.id = v_uid;

  return jsonb_build_object(
    'applied', true,
    'state_changed', state_changed,
    'district_changed', dist_changed
  );
end;
$$;

revoke all on function public.apply_profile_geographic_move(text, text) from public;
grant execute on function public.apply_profile_geographic_move(text, text) to authenticated;
grant execute on function public.apply_profile_geographic_move(text, text) to service_role;

comment on function public.apply_profile_geographic_move(text, text) is
  'Before updating profiles residence/district: approval -10 and revoke House/Senate seat + leadership when geography changes; exempt president/VP/cabinet/SCOTUS.';
