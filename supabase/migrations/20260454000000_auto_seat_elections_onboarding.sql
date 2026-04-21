-- Optional automation: when enabled in simulation_settings, new players who finish character setup
-- can get House + Senate filing races without admin manual creation (open-seat guards in RPC).

alter table public.profiles
  add column if not exists seat_elections_auto_created_at timestamptz;

comment on column public.profiles.seat_elections_auto_created_at is
  'Set once the onboarding auto-seat-election path has run (whether or not races were created).';

alter table public.simulation_settings
  add column if not exists auto_create_seat_elections_on_onboarding boolean not null default false;

comment on column public.simulation_settings.auto_create_seat_elections_on_onboarding is
  'When true, completing character setup may auto-insert House + Senate seat races (see RPC).';

-- ---------- RPC: create seat elections after onboarding (invoker = player) ----------
create or replace function public.auto_create_seat_elections_for_onboarding()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_auto boolean;
  v_prof public.profiles%rowtype;
  v_district text;
  v_house_state char(2);
  v_res_state char(2);
  v_senate_class smallint;
  v_now timestamptz := now();
  v_fo timestamptz;
  v_fc timestamptz;
  v_pc timestamptz;
  v_gc timestamptz;
  v_house_want boolean := false;
  v_senate_want boolean := false;
  v_senators_in_state int := 0;
  v_inserted_house uuid;
  v_inserted_senate uuid;
begin
  if uid is null then
    return jsonb_build_object('error', 'not_authenticated');
  end if;

  select auto_create_seat_elections_on_onboarding into v_auto
  from public.simulation_settings
  where id = 1;

  if not coalesce(v_auto, false) then
    return jsonb_build_object('skipped', 'flag_off');
  end if;

  select * into v_prof from public.profiles where id = uid;
  if not found then
    return jsonb_build_object('error', 'no_profile');
  end if;

  if v_prof.seat_elections_auto_created_at is not null then
    return jsonb_build_object('skipped', 'already_ran');
  end if;

  if coalesce(trim(v_prof.character_name), '') = ''
     or v_prof.date_of_birth is null
     or v_prof.residence_state is null
     or coalesce(trim(v_prof.home_district_code), '') = ''
     or v_prof.party is null then
    return jsonb_build_object('skipped', 'onboarding_incomplete');
  end if;

  perform pg_advisory_xact_lock(hashtext(uid::text));

  if exists (
    select 1 from public.profiles p
    where p.id = uid and p.seat_elections_auto_created_at is not null
  ) then
    return jsonb_build_object('skipped', 'already_ran');
  end if;

  v_district := upper(trim(v_prof.home_district_code));
  select d.state into v_house_state from public.districts d where d.code = v_district limit 1;
  if v_house_state is null then
    return jsonb_build_object('error', 'bad_district');
  end if;

  v_res_state := trim(v_prof.residence_state)::char(2);

  select s.senate_class into v_senate_class from public.states s where s.code = v_res_state limit 1;
  if v_senate_class is null then
    v_senate_class := 1;
  end if;

  v_fo := v_now;
  v_fc := v_now + interval '24 hours';
  v_pc := v_now + interval '48 hours';
  v_gc := v_now + interval '72 hours';

  -- House: skip if an active seat race already exists, or another player already holds this district.
  v_house_want := not exists (
    select 1 from public.elections e
    where e.office = 'house'
      and upper(trim(e.district_code)) = v_district
      and e.phase <> 'closed'::public.election_phase
      and e.leadership_role is null
  ) and not exists (
    select 1 from public.profiles p
    where p.id <> uid
      and upper(trim(p.home_district_code)) = v_district
      and (
        p.office_role = 'representative'
        or exists (
          select 1 from public.government_role_grants g
          where g.user_id = p.id and g.role_key = 'representative'
        )
      )
  );

  select count(*)::int into v_senators_in_state
  from public.profiles p
  where p.residence_state = v_res_state
    and (
      p.office_role = 'senator'
      or exists (
        select 1 from public.government_role_grants g
        where g.user_id = p.id and g.role_key = 'senator'
      )
    );

  v_senate_want := v_senators_in_state < 2
    and not exists (
      select 1 from public.elections e
      where e.office = 'senate'
        and e.state = v_res_state
        and e.senate_class = v_senate_class
        and e.phase <> 'closed'::public.election_phase
        and e.leadership_role is null
    );

  if v_house_want then
    insert into public.elections (
      office,
      state,
      district_code,
      senate_class,
      phase,
      filing_opens_at,
      filing_closes_at,
      primary_closes_at,
      general_closes_at,
      primary_party_wide,
      filing_window_started_at
    ) values (
      'house'::public.election_office,
      v_house_state,
      v_district,
      null,
      'filing'::public.election_phase,
      v_fo,
      v_fc,
      v_pc,
      v_gc,
      true,
      v_fo
    )
    returning id into v_inserted_house;
  end if;

  if v_senate_want then
    insert into public.elections (
      office,
      state,
      district_code,
      senate_class,
      phase,
      filing_opens_at,
      filing_closes_at,
      primary_closes_at,
      general_closes_at,
      primary_party_wide,
      filing_window_started_at
    ) values (
      'senate'::public.election_office,
      v_res_state,
      null,
      v_senate_class,
      'filing'::public.election_phase,
      v_fo,
      v_fc,
      v_pc,
      v_gc,
      true,
      v_fo
    )
    returning id into v_inserted_senate;
  end if;

  update public.profiles
  set seat_elections_auto_created_at = v_now
  where id = uid
    and seat_elections_auto_created_at is null;

  return jsonb_build_object(
    'house_wanted', v_house_want,
    'senate_wanted', v_senate_want,
    'house_election_id', v_inserted_house,
    'senate_election_id', v_inserted_senate
  );
end;
$$;

grant execute on function public.auto_create_seat_elections_for_onboarding() to authenticated;

comment on function public.auto_create_seat_elections_for_onboarding() is
  'Creates open House + Senate filing races for the current user when simulation_settings allows it; idempotent via profiles.seat_elections_auto_created_at.';
