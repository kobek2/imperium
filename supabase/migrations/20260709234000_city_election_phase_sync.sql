-- Sync city election race phases when admins jump the biennium cycle (wall-clock epoch
-- does not retroactively change per-race filing_closes_at timestamps).

create or replace function public._city_sync_elections_to_cycle_phase(p_phase text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n int := 0;
  t timestamptz := now();
begin
  if p_phase not in ('sign_ups_open', 'primaries', 'generals', 'legislative') then
    return 0;
  end if;

  for r in
    select e.id, e.phase
    from public.elections e
    where public._city_is_mb_election(e.office::text, e.state)
      and e.phase <> 'closed'::public.election_phase
    order by e.filing_opens_at nulls last, e.id
  loop
    if p_phase = 'sign_ups_open' then
      update public.elections
      set
        phase = 'filing'::public.election_phase,
        filing_window_started_at = coalesce(filing_window_started_at, t),
        filing_opens_at = coalesce(filing_opens_at, t),
        filing_closes_at = t + interval '12 hours',
        primary_closes_at = t + interval '24 hours',
        general_closes_at = t + interval '48 hours',
        primary_party_wide = true
      where id = r.id;
      n := n + 1;

    elsif p_phase = 'primaries' then
      update public.elections
      set
        phase = 'primary'::public.election_phase,
        filing_window_started_at = coalesce(filing_window_started_at, t - interval '12 hours'),
        filing_closes_at = t - interval '1 second',
        primary_closes_at = t + interval '12 hours',
        general_closes_at = t + interval '36 hours',
        primary_party_wide = true
      where id = r.id;
      n := n + 1;

    elsif p_phase = 'generals' then
      if r.phase in ('filing'::public.election_phase, 'primary'::public.election_phase) then
        perform public._close_primary_for_election(r.id);
      end if;
      update public.elections
      set
        phase = 'general'::public.election_phase,
        filing_window_started_at = coalesce(filing_window_started_at, t - interval '24 hours'),
        filing_closes_at = t - interval '13 hours',
        primary_closes_at = t - interval '1 second',
        general_closes_at = t + interval '24 hours',
        primary_party_wide = true
      where id = r.id;
      n := n + 1;

    elsif p_phase = 'legislative' then
      if r.phase in ('filing'::public.election_phase, 'primary'::public.election_phase) then
        perform public._close_primary_for_election(r.id);
        update public.elections set phase = 'general'::public.election_phase where id = r.id;
      end if;
      if exists (
        select 1 from public.elections e
        where e.id = r.id and e.phase = 'general'::public.election_phase
      ) then
        perform public.tick_npc_campaigns(r.id);
        perform public._close_general_for_election(r.id);
        n := n + 1;
      end if;
    end if;
  end loop;

  return n;
end;
$$;

-- City primaries are always party-wide (every NYC player votes in every council primary).
update public.elections
set primary_party_wide = true
where office in ('mayor', 'council_ward')
  and state = 'MB';

create or replace function public.admin_jump_city_cycle_phase(
  p_city_code char(2) default 'MB',
  p_phase text default 'sign_ups_open'
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
  phase_offset numeric;
  new_epoch timestamptz;
  synced int;
  tick jsonb;
begin
  if v_uid is null or not public.is_staff_admin(v_uid) then
    raise exception 'Admin only';
  end if;

  phase_offset := public._city_phase_start_offset(p_phase);
  if phase_offset is null then
    raise exception 'Invalid phase: %', p_phase;
  end if;

  select coalesce(epoch_started_at, now()) into epoch
  from public.city_sim_engine_state
  where city_code = p_city_code
  for update;

  if epoch is null then
    insert into public.city_sim_engine_state (city_code, sim_tick, sim_year, sim_week, turn_phase, epoch_started_at)
    values (p_city_code, 0, 1, 1, 'sign_ups_open', now());
    epoch := now();
  end if;

  cycle_idx := public._city_cycle_index_from_epoch(epoch);
  new_epoch := now() - make_interval(hours => (cycle_idx * public._city_cycle_hours() + phase_offset)::int);

  update public.city_sim_engine_state
  set epoch_started_at = new_epoch, updated_at = now()
  where city_code = p_city_code;

  tick := public.tick_city_realtime_scheduler(p_city_code);
  synced := public._city_sync_elections_to_cycle_phase(p_phase);

  return tick || jsonb_build_object('jumped_to', p_phase, 'elections_synced', synced);
end;
$$;

create or replace function public.admin_advance_city_cycle_phase(p_city_code char(2) default 'MB')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  epoch timestamptz;
  cycle_idx bigint;
  current_phase text;
  next_phase text;
  phase_offset numeric;
  new_epoch timestamptz;
  synced int;
  tick jsonb;
begin
  if v_uid is null or not public.is_staff_admin(v_uid) then
    raise exception 'Admin only';
  end if;

  select coalesce(epoch_started_at, now()) into epoch
  from public.city_sim_engine_state
  where city_code = p_city_code
  for update;

  if epoch is null then
    return public.admin_jump_city_cycle_phase(p_city_code, 'sign_ups_open');
  end if;

  cycle_idx := public._city_cycle_index_from_epoch(epoch);
  current_phase := public._city_cycle_phase_from_epoch(epoch);

  next_phase := case current_phase
    when 'sign_ups_open' then 'primaries'
    when 'primaries' then 'generals'
    when 'generals' then 'legislative'
    when 'legislative' then 'sign_ups_open'
    else 'sign_ups_open'
  end;

  if current_phase = 'legislative' then
    cycle_idx := cycle_idx + 1;
    phase_offset := 0;
  else
    phase_offset := public._city_phase_start_offset(next_phase);
  end if;

  new_epoch := now() - make_interval(hours => (cycle_idx * public._city_cycle_hours() + phase_offset)::int);

  update public.city_sim_engine_state
  set epoch_started_at = new_epoch, updated_at = now()
  where city_code = p_city_code;

  tick := public.tick_city_realtime_scheduler(p_city_code);
  synced := public._city_sync_elections_to_cycle_phase(next_phase);

  return tick
    || jsonb_build_object('from_phase', current_phase, 'to_phase', next_phase, 'elections_synced', synced);
end;
$$;

create or replace function public.admin_open_class_b_elections_now(p_city_code char(2) default 'MB')
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
begin
  if v_uid is null or not public.is_staff_admin(v_uid) then
    raise exception 'Admin only';
  end if;

  select coalesce(epoch_started_at, now()) into epoch
  from public.city_sim_engine_state
  where city_code = p_city_code;

  cycle_idx := public._city_cycle_index_from_epoch(epoch);
  even_yr := (cycle_idx * 2 + 2)::smallint;
  created := public._city_open_election_cycle(p_city_code, even_yr, now());

  return jsonb_build_object('ok', true, 'created', created, 'sim_year', even_yr, 'wave', 'class_b');
end;
$$;

grant execute on function public._city_sync_elections_to_cycle_phase(text) to authenticated, service_role;
grant execute on function public.admin_open_class_b_elections_now(char) to authenticated, service_role;

notify pgrst, 'reload schema';
