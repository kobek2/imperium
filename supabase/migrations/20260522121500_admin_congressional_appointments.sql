-- Staff admin (is_staff_admin): appoint House/Senate seats and chamber leadership without an election closeout.
-- Mirrors vacate + grant behaviour from public._apply_election_role_transitions (20260511120000).

create or replace function public.admin_appoint_house_seat(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  leadership text[] := array[
    'speaker',
    'house_majority_leader', 'house_majority_whip',
    'house_minority_leader', 'house_minority_whip',
    'senate_majority_leader', 'senate_majority_whip',
    'senate_minority_leader', 'senate_minority_whip',
    'president_pro_tempore'
  ];
  incompat text[] := array['senator', 'president', 'vice_president'];
  district text;
begin
  if auth.uid() is null or not public.is_staff_admin(auth.uid()) then
    raise exception 'Admin only';
  end if;

  select upper(trim(coalesce(p.home_district_code, ''))) into district
  from public.profiles p
  where p.id = p_user_id;
  if district is null or length(district) < 4 then
    raise exception 'Profile needs a valid home_district_code (e.g. CA-12) for a House appointment.';
  end if;

  delete from public.government_role_grants g
  using public.profiles p
  where g.user_id = p.id
    and g.role_key = 'representative'
    and upper(trim(coalesce(p.home_district_code, ''))) = district
    and g.user_id is distinct from p_user_id;

  update public.profiles p
  set office_role = null, updated_at = now()
  where upper(trim(coalesce(p.home_district_code, ''))) = district
    and p.office_role = 'representative'
    and p.id is distinct from p_user_id;

  delete from public.government_role_grants g
  where g.user_id = p_user_id
    and (g.role_key = any(leadership) or g.role_key = any(incompat));

  insert into public.government_role_grants (user_id, role_key)
  values (p_user_id, 'representative')
  on conflict (user_id, role_key) do nothing;

  update public.profiles p
  set office_role = 'representative',
      updated_at = now()
  where p.id = p_user_id
    and (
      p.office_role is null
      or p.office_role = 'citizen'
      or p.office_role = 'representative'
      or p.office_role = any(incompat)
      or p.office_role = any(leadership)
    );

  return jsonb_build_object('ok', true, 'district', district);
end;
$$;

create or replace function public.admin_appoint_senate_seat(p_user_id uuid, p_state text, p_class smallint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  leadership text[] := array[
    'speaker',
    'house_majority_leader', 'house_majority_whip',
    'house_minority_leader', 'house_minority_whip',
    'senate_majority_leader', 'senate_majority_whip',
    'senate_minority_leader', 'senate_minority_whip',
    'president_pro_tempore'
  ];
  incompat text[] := array['representative', 'president', 'vice_president'];
  st text := upper(trim(coalesce(p_state, '')));
  prior_uid uuid;
  res_state text;
begin
  if auth.uid() is null or not public.is_staff_admin(auth.uid()) then
    raise exception 'Admin only';
  end if;
  if st is null or length(st) <> 2 then
    raise exception 'Invalid state code.';
  end if;
  if p_class is null or p_class < 1 or p_class > 3 then
    raise exception 'Senate class must be 1, 2, or 3.';
  end if;

  select upper(trim(coalesce(p.residence_state, ''))) into res_state
  from public.profiles p
  where p.id = p_user_id;
  if res_state is null or res_state <> st then
    raise exception 'Profile residence_state must match the Senate seat state.';
  end if;

  select e.winner_user_id into prior_uid
  from public.elections e
  where e.office = 'senate'
    and upper(trim(coalesce(e.state, ''))) = st
    and e.senate_class = p_class
    and e.phase = 'closed'::public.election_phase
    and e.winner_user_id is not null
  order by e.general_closes_at desc nulls last
  limit 1;

  if prior_uid is not null and prior_uid is distinct from p_user_id then
    delete from public.government_role_grants g
    where g.user_id = prior_uid and g.role_key = 'senator';
    update public.profiles p
    set office_role = null, updated_at = now()
    where p.id = prior_uid and p.office_role = 'senator';
  end if;

  delete from public.government_role_grants g
  where g.user_id = p_user_id
    and (g.role_key = any(leadership) or g.role_key = any(incompat));

  insert into public.government_role_grants (user_id, role_key)
  values (p_user_id, 'senator')
  on conflict (user_id, role_key) do nothing;

  update public.profiles p
  set office_role = 'senator',
      updated_at = now()
  where p.id = p_user_id
    and (
      p.office_role is null
      or p.office_role = 'citizen'
      or p.office_role = 'senator'
      or p.office_role = any(incompat)
      or p.office_role = any(leadership)
    );

  return jsonb_build_object('ok', true, 'state', st, 'class', p_class);
end;
$$;

create or replace function public.admin_appoint_chamber_leadership(p_role text, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  leadership text[] := array[
    'speaker',
    'house_majority_leader', 'house_majority_whip',
    'house_minority_leader', 'house_minority_whip',
    'senate_majority_leader', 'senate_majority_whip',
    'senate_minority_leader', 'senate_minority_whip',
    'president_pro_tempore'
  ];
  chamber_role text;
begin
  if auth.uid() is null or not public.is_staff_admin(auth.uid()) then
    raise exception 'Admin only';
  end if;

  if p_role is null or not (p_role = any(leadership)) then
    raise exception 'Invalid leadership role.';
  end if;

  if p_role in (
    'speaker', 'house_majority_leader', 'house_majority_whip', 'house_minority_leader', 'house_minority_whip'
  ) then
    chamber_role := 'representative';
  else
    chamber_role := 'senator';
  end if;

  if not exists (
    select 1 from public.government_role_grants g
    where g.user_id = p_user_id and g.role_key = chamber_role
  )
  and not exists (
    select 1 from public.profiles p
    where p.id = p_user_id and p.office_role = chamber_role
  ) then
    raise exception 'Appointee must already hold the % chamber seat (grant or office_role).', chamber_role;
  end if;

  delete from public.government_role_grants g
  where g.user_id = p_user_id and g.role_key = any(leadership);

  delete from public.government_role_grants g
  where g.role_key = p_role;

  insert into public.government_role_grants (user_id, role_key)
  values (p_user_id, p_role)
  on conflict (user_id, role_key) do nothing;

  return jsonb_build_object('ok', true, 'role', p_role);
end;
$$;

revoke all on function public.admin_appoint_house_seat(uuid) from public;
revoke all on function public.admin_appoint_senate_seat(uuid, text, smallint) from public;
revoke all on function public.admin_appoint_chamber_leadership(text, uuid) from public;

grant execute on function public.admin_appoint_house_seat(uuid) to authenticated;
grant execute on function public.admin_appoint_senate_seat(uuid, text, smallint) to authenticated;
grant execute on function public.admin_appoint_chamber_leadership(text, uuid) to authenticated;

notify pgrst, 'reload schema';
