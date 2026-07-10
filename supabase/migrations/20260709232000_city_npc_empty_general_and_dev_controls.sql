-- City NPCs only when no player filed; admin dev controls to jump cycle phases and advance elections.

-- ─── City NPC: incumbent fallback when general would be empty ─────────────────

create or replace function public._city_general_has_player_candidates(p_election_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.election_candidates ec
    where ec.election_id = p_election_id
      and coalesce(ec.is_npc, false) = false
  );
$$;

create or replace function public._city_incumbent_party_slug(p_incumbent_party text, p_lean numeric)
returns text
language sql
immutable
as $$
  select case
    when lower(trim(coalesce(p_incumbent_party, ''))) in ('d', 'dem', 'democrat') then 'democrat'
    when lower(trim(coalesce(p_incumbent_party, ''))) in ('r', 'rep', 'republican') then 'republican'
    when coalesce(p_lean, 0) >= 0 then 'democrat'
    else 'republican'
  end;
$$;

create or replace function public._city_seed_incumbent_npc_if_general_empty(p_election_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  race record;
  lean numeric := 0;
  incumbent_party text := null;
  incumbent_name text := null;
  incumbent_politician_id uuid := null;
  office_text text;
  inc_pol public.sim_politicians;
  party_slug text;
  npc_id uuid;
begin
  select e.id, e.office, e.state, e.district_code, e.ward_code, e.senate_class, e.phase
    into race
    from public.elections e
    where e.id = p_election_id;
  if not found then
    return false;
  end if;
  if not public._city_is_mb_election(race.office::text, race.state) then
    return false;
  end if;
  if race.phase not in ('filing', 'primary', 'general') then
    return false;
  end if;
  if public._city_general_has_player_candidates(p_election_id) then
    return false;
  end if;

  office_text := race.office::text;

  if race.office = 'council_ward' and race.ward_code is not null then
    select w.pvi, w.incumbent_party, w.incumbent_npc_name, w.incumbent_politician_id
      into lean, incumbent_party, incumbent_name, incumbent_politician_id
    from public.wards w
    where w.code = race.ward_code;
    lean := coalesce(lean, 0);
  elsif race.office = 'mayor' then
    select 0, ms.incumbent_party, sp.character_name, ms.incumbent_politician_id
      into lean, incumbent_party, incumbent_name, incumbent_politician_id
    from public.mayor_seat ms
    left join public.sim_politicians sp on sp.id = ms.incumbent_politician_id
    where ms.city_code = 'MB';
    lean := coalesce(lean, 0);
  end if;

  select * into inc_pol
  from public._incumbent_politician_for_race(
    office_text, race.district_code, race.state, race.senate_class, race.ward_code
  );
  if found then
    incumbent_politician_id := inc_pol.id;
    incumbent_name := inc_pol.character_name;
    incumbent_party := case inc_pol.party
      when 'democrat' then 'D'
      when 'republican' then 'R'
      else incumbent_party
    end;
  end if;

  party_slug := public._city_incumbent_party_slug(incumbent_party, lean);

  npc_id := public._npc_insert_party_placeholder(
    p_election_id, party_slug, lean, office_text, race.state, race.district_code,
    incumbent_party, incumbent_name, incumbent_politician_id, race.ward_code
  );

  if npc_id is not null then
    update public.election_candidates
    set primary_winner = true
    where id = npc_id;
    update public.elections
    set npc_opponents_seeded = true
    where id = p_election_id;
    return true;
  end if;

  return false;
end;
$$;

create or replace function public.seed_election_npc_opponents(p_election_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  race record;
  lean numeric := 0;
  incumbent_party text := null;
  incumbent_name text := null;
  incumbent_politician_id uuid := null;
  inserted boolean := false;
  dem_id uuid;
  rep_id uuid;
  office_text text;
  inc_pol public.sim_politicians;
begin
  select e.id, e.office, e.state, e.district_code, e.ward_code, e.senate_class, e.leadership_role, e.phase
    into race
    from public.elections e
    where e.id = p_election_id;
  if not found then
    return false;
  end if;
  if race.leadership_role is not null then
    return false;
  end if;
  if race.phase not in ('filing', 'primary', 'general') then
    return false;
  end if;

  if public._city_is_mb_election(race.office::text, race.state) then
    return public._city_seed_incumbent_npc_if_general_empty(p_election_id);
  end if;

  office_text := race.office::text;

  if race.office = 'house' and race.district_code is not null then
    select d.pvi, d.incumbent_party, d.incumbent_npc_name, d.incumbent_politician_id
      into lean, incumbent_party, incumbent_name, incumbent_politician_id
    from public.districts d
    where d.code = race.district_code;
    lean := coalesce(lean, 0);
  elsif race.office = 'senate' and race.state is not null and race.senate_class is not null then
    select coalesce(s.pvi, 0), seat.incumbent_party, sp.character_name, seat.incumbent_politician_id
      into lean, incumbent_party, incumbent_name, incumbent_politician_id
    from public.states s
    left join public.senate_seats seat
      on seat.state_code = race.state and seat.senate_class = race.senate_class
    left join public.sim_politicians sp on sp.id = seat.incumbent_politician_id
    where s.code = race.state;
    lean := coalesce(lean, 0);
  elsif race.office = 'council_ward' and race.ward_code is not null then
    select w.pvi, w.incumbent_party, w.incumbent_npc_name, w.incumbent_politician_id
      into lean, incumbent_party, incumbent_name, incumbent_politician_id
    from public.wards w
    where w.code = race.ward_code;
    lean := coalesce(lean, 0);
  elsif race.office = 'mayor' then
    select 0, ms.incumbent_party, sp.character_name, ms.incumbent_politician_id
      into lean, incumbent_party, incumbent_name, incumbent_politician_id
    from public.mayor_seat ms
    left join public.sim_politicians sp on sp.id = ms.incumbent_politician_id
    where ms.city_code = 'MB';
    lean := coalesce(lean, 0);
  end if;

  select * into inc_pol
  from public._incumbent_politician_for_race(
    office_text, race.district_code, race.state, race.senate_class, race.ward_code
  );
  if found then
    incumbent_politician_id := inc_pol.id;
    incumbent_name := inc_pol.character_name;
    incumbent_party := case inc_pol.party
      when 'democrat' then 'D'
      when 'republican' then 'R'
      else incumbent_party
    end;
  end if;

  dem_id := public._npc_insert_party_placeholder(
    p_election_id, 'democrat', lean, office_text, race.state, race.district_code,
    incumbent_party, incumbent_name, incumbent_politician_id, race.ward_code
  );
  rep_id := public._npc_insert_party_placeholder(
    p_election_id, 'republican', lean, office_text, race.state, race.district_code,
    incumbent_party, incumbent_name, incumbent_politician_id, race.ward_code
  );

  if dem_id is not null or rep_id is not null then
    inserted := true;
    update public.elections set npc_opponents_seeded = true where id = p_election_id;
  end if;

  return inserted;
end;
$$;

create or replace function public.finalize_election_party_nominees(p_election_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p text;
  best_id uuid;
  party_npc_id uuid;
  race record;
begin
  select e.office, e.state into race
  from public.elections e
  where e.id = p_election_id;

  if not public._city_is_mb_election(race.office::text, race.state) then
    perform public.seed_election_npc_opponents(p_election_id);
  end if;

  for p in select unnest(array['democrat', 'republican']::text[])
  loop
    best_id := null;

    select ec.id into best_id
    from public.election_candidates ec
    left join lateral (
      select count(*)::bigint as votes
      from public.primary_votes pv
      where pv.election_id = p_election_id and pv.candidate_id = ec.id
    ) v on true
    where ec.election_id = p_election_id
      and ec.party = p
      and coalesce(ec.is_npc, false) = false
    order by coalesce(v.votes, 0) desc, ec.created_at nulls last, ec.id
    limit 1;

    select ec.id into party_npc_id
    from public.election_candidates ec
    where ec.election_id = p_election_id
      and ec.party = p
      and coalesce(ec.is_npc, false) = true
    limit 1;

    if best_id is not null then
      delete from public.election_candidates ec
      where ec.election_id = p_election_id
        and ec.party = p
        and coalesce(ec.is_npc, false) = false
        and ec.id <> best_id;

      if party_npc_id is not null then
        delete from public.election_candidates where id = party_npc_id;
      end if;

      update public.election_candidates
      set primary_winner = true
      where id = best_id;
    elsif party_npc_id is not null then
      update public.election_candidates
      set primary_winner = true
      where id = party_npc_id;
    end if;
  end loop;

  for p in
    select distinct ec.party
    from public.election_candidates ec
    where ec.election_id = p_election_id
      and coalesce(ec.is_npc, false) = false
      and ec.party not in ('democrat', 'republican')
  loop
    best_id := null;

    select ec.id into best_id
    from public.election_candidates ec
    left join lateral (
      select count(*)::bigint as votes
      from public.primary_votes pv
      where pv.election_id = p_election_id and pv.candidate_id = ec.id
    ) v on true
    where ec.election_id = p_election_id
      and ec.party = p
      and coalesce(ec.is_npc, false) = false
    order by coalesce(v.votes, 0) desc, ec.created_at nulls last, ec.id
    limit 1;

    if best_id is not null then
      delete from public.election_candidates ec
      where ec.election_id = p_election_id
        and ec.party = p
        and coalesce(ec.is_npc, false) = false
        and ec.id <> best_id;

      update public.election_candidates
      set primary_winner = true
      where id = best_id;
    end if;
  end loop;

  if public._city_is_mb_election(race.office::text, race.state) then
    perform public._city_seed_incumbent_npc_if_general_empty(p_election_id);
  end if;
end;
$$;

create or replace function public.open_millbrook_election_filings()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  e record;
  opened int := 0;
begin
  if v_uid is null or not public.is_staff_admin(v_uid) then raise exception 'Admin only'; end if;
  perform public.ensure_millbrook_election_templates();

  for e in
    select id from public.elections
    where office in ('mayor', 'council_ward')
      and state = 'MB'
      and phase = 'filing'
      and filing_window_started_at is null
  loop
    update public.elections set filing_window_started_at = now() where id = e.id;
    opened := opened + 1;
  end loop;

  return jsonb_build_object('ok', true, 'opened', opened);
end;
$$;

-- ─── Admin dev controls (staff operators) ───────────────────────────────────

create or replace function public._city_phase_start_offset(p_phase text)
returns numeric
language sql
immutable
as $$
  select case p_phase
    when 'sign_ups_open' then 0::numeric
    when 'primaries' then public._city_signups_hours()
    when 'generals' then public._city_signups_hours() + public._city_primary_hours()
    when 'legislative' then public._city_signups_hours() + public._city_primary_hours() + public._city_general_hours()
    else null
  end;
$$;

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

  return public.tick_city_realtime_scheduler(p_city_code)
    || jsonb_build_object('jumped_to', p_phase);
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

  return public.tick_city_realtime_scheduler(p_city_code)
    || jsonb_build_object('from_phase', current_phase, 'to_phase', next_phase);
end;
$$;

create or replace function public.admin_open_city_elections_now(p_city_code char(2) default 'MB')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  epoch timestamptz;
  sim_yr smallint;
  cycle_idx bigint;
  pos numeric;
  even_yr smallint;
  created int := 0;
  class_b_created int := 0;
begin
  if v_uid is null or not public.is_staff_admin(v_uid) then
    raise exception 'Admin only';
  end if;

  select coalesce(epoch_started_at, now()) into epoch
  from public.city_sim_engine_state
  where city_code = p_city_code;

  sim_yr := public._city_sim_year_from_epoch(epoch);
  cycle_idx := public._city_cycle_index_from_epoch(epoch);
  pos := public._city_position_in_cycle_hours(epoch);
  even_yr := (cycle_idx * 2 + 2)::smallint;

  created := public._city_open_election_cycle(p_city_code, sim_yr, now());

  if pos >= public._city_sim_year_hours() then
    class_b_created := public._city_open_election_cycle(p_city_code, even_yr, now());
  end if;

  return jsonb_build_object(
    'ok', true,
    'created', created,
    'class_b_created', class_b_created,
    'sim_year', sim_yr
  );
end;
$$;

create or replace function public.admin_advance_city_election_track(p_city_code char(2) default 'MB')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  r record;
  advanced int := 0;
begin
  if v_uid is null or not public.is_staff_admin(v_uid) then
    raise exception 'Admin only';
  end if;

  for r in
    select e.id, e.phase
    from public.elections e
    where public._city_is_mb_election(e.office::text, e.state)
      and e.phase <> 'closed'::public.election_phase
    order by e.filing_opens_at nulls last, e.id
  loop
    if r.phase = 'filing'::public.election_phase then
      update public.elections
      set
        phase = 'primary'::public.election_phase,
        filing_closes_at = coalesce(filing_closes_at, now())
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

  return jsonb_build_object('ok', true, 'advanced', advanced);
end;
$$;

create or replace function public.admin_advance_city_sim_week(
  p_city_code char(2) default 'MB',
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.admin_advance_city_cycle_phase(p_city_code);
end;
$$;

create or replace function public.admin_advance_city_sim_turn(
  p_city_code char(2) default 'MB',
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.admin_advance_city_cycle_phase(p_city_code);
end;
$$;

grant execute on function public._city_general_has_player_candidates(uuid) to authenticated, service_role;
grant execute on function public._city_incumbent_party_slug(text, numeric) to authenticated, service_role;
grant execute on function public._city_seed_incumbent_npc_if_general_empty(uuid) to authenticated, service_role;
grant execute on function public.admin_jump_city_cycle_phase(char, text) to authenticated, service_role;
grant execute on function public.admin_advance_city_cycle_phase(char) to authenticated, service_role;
grant execute on function public.admin_open_city_elections_now(char) to authenticated, service_role;
grant execute on function public.admin_advance_city_election_track(char) to authenticated, service_role;

notify pgrst, 'reload schema';
