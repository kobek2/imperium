-- Drop ambiguous admin_open_class_b_elections_now(char) overload; add smart election-wave advance.

drop function if exists public.admin_open_class_b_elections_now(char);

create or replace function public.admin_open_class_b_elections_now(
  p_city_code char(2) default 'MB',
  p_reopen_closed boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  epoch timestamptz;
  cycle_idx bigint;
  even_yr smallint;
  created int := 0;
  reopened int := 0;
  existing_active int := 0;
  existing_closed int := 0;
  wards_expected int := 0;
  t0 timestamptz := now();
begin
  if v_uid is null or not public.is_staff_admin(v_uid) then
    raise exception 'Admin only';
  end if;

  select coalesce(epoch_started_at, now()) into epoch
  from public.city_sim_engine_state
  where city_code = p_city_code;

  cycle_idx := public._city_cycle_index_from_epoch(epoch);
  even_yr := (cycle_idx * 2 + 2)::smallint;

  select count(*)::int into wards_expected
  from public.wards w
  where w.city_code = p_city_code and w.election_class = 'B';

  created := public._city_open_election_cycle(p_city_code, even_yr, t0);

  select count(*)::int into existing_active
  from public.elections e
  join public.wards w on w.code = e.ward_code and w.city_code = p_city_code
  where public._city_is_mb_election(e.office::text, e.state)
    and e.office = 'council_ward'
    and w.election_class = 'B'
    and e.city_sim_year = even_yr
    and e.phase <> 'closed'::public.election_phase;

  select count(*)::int into existing_closed
  from public.elections e
  join public.wards w on w.code = e.ward_code and w.city_code = p_city_code
  where public._city_is_mb_election(e.office::text, e.state)
    and e.office = 'council_ward'
    and w.election_class = 'B'
    and e.city_sim_year = even_yr
    and e.phase = 'closed'::public.election_phase;

  update public.elections e
  set
    filing_window_started_at = coalesce(e.filing_window_started_at, t0),
    filing_opens_at = coalesce(e.filing_opens_at, t0),
    filing_closes_at = coalesce(e.filing_closes_at, t0 + interval '12 hours'),
    primary_closes_at = coalesce(e.primary_closes_at, t0 + interval '24 hours'),
    general_closes_at = coalesce(e.general_closes_at, t0 + interval '48 hours'),
    phase = case
      when e.phase = 'closed'::public.election_phase then e.phase
      else coalesce(e.phase, 'filing'::public.election_phase)
    end
  from public.wards w
  where e.ward_code = w.code
    and w.city_code = p_city_code
    and w.election_class = 'B'
    and public._city_is_mb_election(e.office::text, e.state)
    and e.city_sim_year = even_yr
    and e.filing_window_started_at is null;

  if p_reopen_closed and created = 0 and existing_active = 0 and existing_closed > 0 then
    update public.elections e
    set
      phase = 'filing'::public.election_phase,
      filing_window_started_at = t0,
      filing_opens_at = t0,
      filing_closes_at = t0 + interval '12 hours',
      primary_closes_at = t0 + interval '24 hours',
      general_closes_at = t0 + interval '48 hours',
      oath_pending = false
    from public.wards w
    where e.ward_code = w.code
      and w.city_code = p_city_code
      and w.election_class = 'B'
      and public._city_is_mb_election(e.office::text, e.state)
      and e.city_sim_year = even_yr
      and e.phase = 'closed'::public.election_phase;

    get diagnostics reopened = row_count;

    select count(*)::int into existing_active
    from public.elections e
    join public.wards w on w.code = e.ward_code and w.city_code = p_city_code
    where public._city_is_mb_election(e.office::text, e.state)
      and e.office = 'council_ward'
      and w.election_class = 'B'
      and e.city_sim_year = even_yr
      and e.phase <> 'closed'::public.election_phase;
  end if;

  return jsonb_build_object(
    'ok', true,
    'created', created,
    'reopened', reopened,
    'existing_active', existing_active,
    'existing_closed', existing_closed,
    'wards_expected', wards_expected,
    'sim_year', even_yr,
    'wave', 'class_b'
  );
end;
$$;

create or replace function public._city_admin_jump_cycle_position(
  p_city_code char(2),
  p_cycle_idx bigint,
  p_hours_into_cycle numeric,
  p_phase text default 'sign_ups_open'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  phase_offset numeric;
  new_epoch timestamptz;
  synced int;
  tick jsonb;
begin
  phase_offset := public._city_phase_start_offset(p_phase);
  if phase_offset is null then
    raise exception 'Invalid phase: %', p_phase;
  end if;

  new_epoch := now() - make_interval(
    hours => (p_cycle_idx * public._city_cycle_hours() + p_hours_into_cycle + phase_offset)::int
  );

  update public.city_sim_engine_state
  set epoch_started_at = new_epoch, updated_at = now()
  where city_code = p_city_code;

  tick := public.tick_city_realtime_scheduler(p_city_code);
  synced := public._city_sync_elections_to_cycle_phase(p_phase);

  return tick
    || jsonb_build_object(
      'jumped_to', p_phase,
      'cycle_idx', p_cycle_idx,
      'hours_into_cycle', p_hours_into_cycle,
      'elections_synced', synced
    );
end;
$$;

create or replace function public._city_wave_election_stats(
  p_city_code char(2),
  p_sim_year smallint,
  p_council_class char(1)
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  expected int := 0;
  active int := 0;
  closed int := 0;
  opened int := 0;
begin
  if p_council_class = 'A' then
    expected := 4;
    if public._city_mayor_election_active(p_sim_year) then
      expected := expected + 1;
    end if;

    select count(*)::int into active
    from public.elections e
    where public._city_is_mb_election(e.office::text, e.state)
      and e.city_sim_year = p_sim_year
      and e.phase <> 'closed'::public.election_phase
      and (
        e.office = 'mayor'
        or exists (
          select 1 from public.wards w
          where w.code = e.ward_code and w.city_code = p_city_code and w.election_class = 'A'
        )
      );

    select count(*)::int into closed
    from public.elections e
    where public._city_is_mb_election(e.office::text, e.state)
      and e.city_sim_year = p_sim_year
      and e.phase = 'closed'::public.election_phase
      and (
        e.office = 'mayor'
        or exists (
          select 1 from public.wards w
          where w.code = e.ward_code and w.city_code = p_city_code and w.election_class = 'A'
        )
      );
  else
    expected := 3;

    select count(*)::int into active
    from public.elections e
    join public.wards w on w.code = e.ward_code and w.city_code = p_city_code
    where public._city_is_mb_election(e.office::text, e.state)
      and e.office = 'council_ward'
      and w.election_class = 'B'
      and e.city_sim_year = p_sim_year
      and e.phase <> 'closed'::public.election_phase;

    select count(*)::int into closed
    from public.elections e
    join public.wards w on w.code = e.ward_code and w.city_code = p_city_code
    where public._city_is_mb_election(e.office::text, e.state)
      and e.office = 'council_ward'
      and w.election_class = 'B'
      and e.city_sim_year = p_sim_year
      and e.phase = 'closed'::public.election_phase;
  end if;

  opened := active + closed;

  return jsonb_build_object(
    'sim_year', p_sim_year,
    'council_class', p_council_class,
    'expected', expected,
    'active', active,
    'closed', closed,
    'opened', opened,
    'all_closed', active = 0 and closed >= expected and opened > 0,
    'needs_open', opened < expected
  );
end;
$$;

create or replace function public._city_advance_sim_year_elections(
  p_city_code char(2),
  p_sim_year smallint,
  p_council_class char(1)
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  advanced int := 0;
begin
  for r in
    select e.id, e.phase
    from public.elections e
    left join public.wards w on w.code = e.ward_code and w.city_code = p_city_code
    where public._city_is_mb_election(e.office::text, e.state)
      and e.city_sim_year = p_sim_year
      and e.phase <> 'closed'::public.election_phase
      and (
        (p_council_class = 'A' and (e.office = 'mayor' or w.election_class = 'A'))
        or (p_council_class = 'B' and e.office = 'council_ward' and w.election_class = 'B')
      )
    order by e.filing_opens_at nulls last, e.id
  loop
    if r.phase = 'filing'::public.election_phase then
      update public.elections
      set
        phase = 'primary'::public.election_phase,
        filing_closes_at = coalesce(filing_closes_at, now()),
        filing_window_started_at = coalesce(filing_window_started_at, now())
      where id = r.id;
      advanced := advanced + 1;
    elsif r.phase = 'primary'::public.election_phase then
      perform public._close_primary_for_election(r.id);
      update public.elections
      set
        phase = 'general'::public.election_phase,
        primary_closes_at = coalesce(primary_closes_at, now())
      where id = r.id;
      advanced := advanced + 1;
    elsif r.phase = 'general'::public.election_phase then
      perform public.tick_npc_campaigns(r.id);
      perform public._close_general_for_election(r.id);
      advanced := advanced + 1;
    end if;
  end loop;

  return advanced;
end;
$$;

create or replace function public._city_resolve_wave_cycle_phase(
  p_city_code char(2),
  p_sim_year smallint,
  p_council_class char(1)
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.elections e
    left join public.wards w on w.code = e.ward_code and w.city_code = p_city_code
    where public._city_is_mb_election(e.office::text, e.state)
      and e.city_sim_year = p_sim_year
      and e.phase = 'general'::public.election_phase
      and (
        (p_council_class = 'A' and (e.office = 'mayor' or w.election_class = 'A'))
        or (p_council_class = 'B' and e.office = 'council_ward' and w.election_class = 'B')
      )
  ) then
    return 'generals';
  end if;

  if exists (
    select 1
    from public.elections e
    left join public.wards w on w.code = e.ward_code and w.city_code = p_city_code
    where public._city_is_mb_election(e.office::text, e.state)
      and e.city_sim_year = p_sim_year
      and e.phase = 'primary'::public.election_phase
      and (
        (p_council_class = 'A' and (e.office = 'mayor' or w.election_class = 'A'))
        or (p_council_class = 'B' and e.office = 'council_ward' and w.election_class = 'B')
      )
  ) then
    return 'primaries';
  end if;

  return 'sign_ups_open';
end;
$$;

create or replace function public.admin_advance_city_election_wave(
  p_city_code char(2) default 'MB'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  epoch timestamptz;
  cycle_idx bigint;
  biennium smallint;
  wave1_yr smallint;
  wave2_yr smallint;
  w1 jsonb;
  w2 jsonb;
  created int := 0;
  advanced int := 0;
  open_b jsonb;
  jump jsonb;
  action text;
  detail text;
  target_phase text;
  hours_base numeric;
  t0 timestamptz := now();
begin
  if v_uid is null or not public.is_staff_admin(v_uid) then
    raise exception 'Admin only';
  end if;

  select coalesce(epoch_started_at, now()) into epoch
  from public.city_sim_engine_state
  where city_code = p_city_code;

  cycle_idx := public._city_cycle_index_from_epoch(epoch);
  biennium := (cycle_idx + 1)::smallint;
  wave1_yr := (cycle_idx * 2 + 1)::smallint;
  wave2_yr := (cycle_idx * 2 + 2)::smallint;

  w1 := public._city_wave_election_stats(p_city_code, wave1_yr, 'A');
  w2 := public._city_wave_election_stats(p_city_code, wave2_yr, 'B');

  -- Active Wave 1 races → advance one phase.
  if (w1->>'active')::int > 0 then
    advanced := public._city_advance_sim_year_elections(p_city_code, wave1_yr, 'A');
    target_phase := public._city_resolve_wave_cycle_phase(p_city_code, wave1_yr, 'A');
    hours_base := 0;
    action := 'advance_wave_1';
    detail := format(
      'Advanced %s Wave 1 race(s) (Year %s · mayor + W01–W04) → %s',
      advanced, wave1_yr, target_phase
    );
    jump := public._city_admin_jump_cycle_position(p_city_code, cycle_idx, hours_base, target_phase);
    return jump || jsonb_build_object(
      'ok', true, 'action', action, 'message', detail,
      'biennium', biennium, 'wave', 1, 'sim_year', wave1_yr, 'advanced', advanced,
      'cycle_phase', target_phase
    );
  end if;

  -- Active Wave 2 races → advance one phase.
  if (w2->>'active')::int > 0 then
    advanced := public._city_advance_sim_year_elections(p_city_code, wave2_yr, 'B');
    target_phase := public._city_resolve_wave_cycle_phase(p_city_code, wave2_yr, 'B');
    hours_base := public._city_sim_year_hours();
    action := 'advance_wave_2';
    detail := format(
      'Advanced %s Wave 2 race(s) (Year %s · W05–W07) → %s',
      advanced, wave2_yr, target_phase
    );
    jump := public._city_admin_jump_cycle_position(p_city_code, cycle_idx, hours_base, target_phase);
    return jump || jsonb_build_object(
      'ok', true, 'action', action, 'message', detail,
      'biennium', biennium, 'wave', 2, 'sim_year', wave2_yr, 'advanced', advanced,
      'cycle_phase', target_phase
    );
  end if;

  -- Open Wave 1 when not fully closed.
  if coalesce((w1->>'all_closed')::boolean, false) is not true then
    jump := public._city_admin_jump_cycle_position(p_city_code, cycle_idx, 0, 'sign_ups_open');
    created := public._city_open_election_cycle(p_city_code, wave1_yr, t0);
    action := 'open_wave_1';
    detail := format(
      'Biennium %s · Year %s Wave 1: opened %s race(s) (mayor + districts W01–W04)',
      biennium, wave1_yr, created
    );
    return jump || jsonb_build_object(
      'ok', true, 'action', action, 'message', detail,
      'biennium', biennium, 'wave', 1, 'sim_year', wave1_yr, 'created', created
    );
  end if;

  -- Open Wave 2 when Wave 1 is done.
  if coalesce((w2->>'all_closed')::boolean, false) is not true then
    jump := public._city_admin_jump_cycle_position(
      p_city_code, cycle_idx, public._city_sim_year_hours(), 'sign_ups_open'
    );
    open_b := public.admin_open_class_b_elections_now(p_city_code, true);
    action := 'open_wave_2';
    detail := format(
      'Biennium %s · Year %s Wave 2: Class B council (W05–W07) — %s new, %s reopened, %s active',
      biennium,
      wave2_yr,
      coalesce((open_b->>'created')::int, 0),
      coalesce((open_b->>'reopened')::int, 0),
      coalesce((open_b->>'existing_active')::int, 0)
    );
    return jump || open_b || jsonb_build_object(
      'ok', true, 'action', action, 'message', detail,
      'biennium', biennium, 'wave', 2, 'sim_year', wave2_yr
    );
  end if;

  -- Both waves complete → next biennium Wave 1.
  cycle_idx := cycle_idx + 1;
  biennium := (cycle_idx + 1)::smallint;
  wave1_yr := (cycle_idx * 2 + 1)::smallint;
  jump := public._city_admin_jump_cycle_position(p_city_code, cycle_idx, 0, 'sign_ups_open');
  created := public._city_open_election_cycle(p_city_code, wave1_yr, t0);
  action := 'start_next_biennium';
  detail := format(
    'Biennium %s · Year %s Wave 1: opened %s race(s) (mayor + W01–W04)',
    biennium, wave1_yr, created
  );
  return jump || jsonb_build_object(
    'ok', true, 'action', action, 'message', detail,
    'biennium', biennium, 'wave', 1, 'sim_year', wave1_yr, 'created', created
  );
end;
$$;

grant execute on function public.admin_open_class_b_elections_now(char, boolean) to authenticated, service_role;
grant execute on function public.admin_advance_city_election_wave(char) to authenticated, service_role;

notify pgrst, 'reload schema';
