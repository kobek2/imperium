-- City campaign scoring: lower NPC starting points and cap NPC lead over players at +10.

create or replace function public._city_npc_starting_points(
  p_party text,
  p_lean numeric,
  p_incumbent_party text default null
)
returns numeric
language sql
immutable
as $$
  select 5::numeric + least(5::numeric, public._npc_favored_party_bonus(p_party, p_lean, p_incumbent_party));
$$;

create or replace function public._city_npc_campaign_ceiling(p_election_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select max(coalesce(ec.campaign_points_total, 0))
    from public.election_candidates ec
    where ec.election_id = p_election_id
      and coalesce(ec.is_npc, false) = false
  ), 0::numeric) + 10::numeric;
$$;

create or replace function public._cap_city_npc_campaign_advantage(p_election_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  race record;
  ceiling numeric;
  npc record;
  speech_sum numeric;
  new_total numeric;
  new_base numeric;
begin
  select e.office, e.state into race
  from public.elections e
  where e.id = p_election_id;
  if not found or not public._city_is_mb_election(race.office::text, race.state) then
    return;
  end if;

  ceiling := public._city_npc_campaign_ceiling(p_election_id);

  for npc in
    select ec.id
    from public.election_candidates ec
    where ec.election_id = p_election_id
      and coalesce(ec.is_npc, false) = true
    for update
  loop
    select coalesce(sum(nca.points_delta), 0) into speech_sum
    from public.npc_campaign_actions nca
    where nca.npc_candidate_id = npc.id
      and nca.action_type = 'speech'
      and nca.succeeded;

    select ec.campaign_points_total, ec.npc_base_campaign_points
      into new_total, new_base
    from public.election_candidates ec
    where ec.id = npc.id;

    new_total := coalesce(new_base, new_total, 0) + speech_sum;
    if new_total > ceiling then
      new_total := ceiling;
      new_base := greatest(0::numeric, ceiling - speech_sum);
      update public.election_candidates
      set campaign_points_total = new_total,
          npc_base_campaign_points = new_base
      where id = npc.id;
    elsif coalesce(new_base, 0) > ceiling then
      update public.election_candidates
      set npc_base_campaign_points = greatest(0::numeric, ceiling - speech_sum),
          campaign_points_total = least(coalesce(campaign_points_total, 0), ceiling)
      where id = npc.id;
    elsif coalesce(new_total, 0) > ceiling then
      update public.election_candidates
      set campaign_points_total = ceiling
      where id = npc.id;
    end if;
  end loop;
end;
$$;

create or replace function public._npc_insert_party_placeholder(
  p_election_id uuid,
  p_party text,
  p_lean numeric,
  p_office text,
  p_state text,
  p_district text,
  p_incumbent_party text,
  p_incumbent_name text,
  p_incumbent_politician_id uuid default null,
  p_ward text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_id uuid;
  npc_label text;
  npc_pts numeric;
  npc_votes numeric;
  new_id uuid;
  pol public.sim_politicians;
  race_senate_class smallint;
  race_phase public.election_phase;
  nominee_now boolean := false;
  is_city boolean := false;
begin
  is_city := public._city_is_mb_election(p_office, p_state);

  select e.phase into race_phase
  from public.elections e
  where e.id = p_election_id;

  if exists (
    select 1
    from public.election_candidates ec
    where ec.election_id = p_election_id
      and ec.party = p_party
      and coalesce(ec.is_npc, false) = false
      and ec.primary_winner is true
  ) then
    return null;
  end if;

  if race_phase in ('filing'::public.election_phase, 'primary'::public.election_phase)
     and exists (
       select 1
       from public.election_candidates ec
       where ec.election_id = p_election_id
         and ec.party = p_party
         and coalesce(ec.is_npc, false) = false
     ) then
    return null;
  end if;

  if race_phase = 'general'::public.election_phase
     and exists (
       select 1
       from public.election_candidates ec
       where ec.election_id = p_election_id
         and ec.party = p_party
         and coalesce(ec.is_npc, false) = false
     ) then
    return null;
  end if;

  select ec.id into existing_id
  from public.election_candidates ec
  where ec.election_id = p_election_id
    and ec.party = p_party
    and coalesce(ec.is_npc, false) = true
  limit 1;

  if existing_id is not null then
    return existing_id;
  end if;

  nominee_now := race_phase = 'general'::public.election_phase;

  select e.senate_class into race_senate_class from public.elections e where e.id = p_election_id;

  select * into pol from public._sim_politician_for_seat(
    p_office, p_district, p_state, race_senate_class, p_party, p_ward
  );

  npc_label := coalesce(
    pol.character_name,
    public._npc_party_label(p_office, p_state, p_district, p_party, p_incumbent_party, p_incumbent_name, p_ward)
  );

  if is_city then
    npc_pts := public._city_npc_starting_points(p_party, p_lean, p_incumbent_party);
  else
    npc_pts := public._npc_party_points(p_party, p_lean, p_incumbent_party);
  end if;

  npc_votes := 10 + public._npc_favored_party_bonus(p_party, p_lean, p_incumbent_party);

  insert into public.election_candidates (
    election_id, user_id, party, is_npc, npc_name, sim_politician_id,
    npc_synthetic_votes, campaign_points_total, npc_base_campaign_points, primary_winner
  ) values (
    p_election_id, null, p_party, true, npc_label, pol.id,
    npc_votes, npc_pts, npc_pts, nominee_now
  )
  returning id into new_id;

  if is_city then
    perform public._cap_city_npc_campaign_advantage(p_election_id);
  end if;

  return new_id;
end;
$$;

create or replace function public._npc_deliver_scheduled_speech(p_npc_candidate uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  npc record;
  race record;
  speech_pts numeric := 3;
  npc_label text;
  speech_sum numeric;
  new_total numeric;
  new_base numeric;
  ceiling numeric;
begin
  select ec.id, ec.election_id, ec.npc_name, ec.npc_last_speech_at, ec.is_npc,
         ec.npc_base_campaign_points, ec.campaign_points_total
    into npc
    from public.election_candidates ec
    where ec.id = p_npc_candidate
    for update;
  if npc.id is null or not coalesce(npc.is_npc, false) then
    return false;
  end if;

  select e.id, e.phase, e.general_closes_at, e.office, e.state
    into race
    from public.elections e
    where e.id = npc.election_id;
  if race.phase <> 'general' or (race.general_closes_at is not null and now() > race.general_closes_at) then
    return false;
  end if;

  if npc.npc_last_speech_at is not null
     and now() < npc.npc_last_speech_at + interval '3 hours' then
    return false;
  end if;

  npc_label := coalesce(nullif(trim(npc.npc_name), ''), 'Opponent');

  insert into public.npc_campaign_actions (
    election_id, npc_candidate_id, action_type, succeeded, points_delta, message
  ) values (
    npc.election_id,
    p_npc_candidate,
    'speech',
    true,
    speech_pts,
    npc_label || ' held a press tour and sharpened their message (+' || speech_pts::text || ' pts).'
  );

  select coalesce(sum(nca.points_delta), 0) into speech_sum
  from public.npc_campaign_actions nca
  where nca.npc_candidate_id = p_npc_candidate
    and nca.action_type = 'speech'
    and nca.succeeded;

  new_total := coalesce(npc.npc_base_campaign_points, npc.campaign_points_total, 0) + speech_sum;
  new_base := coalesce(npc.npc_base_campaign_points, npc.campaign_points_total, 0);

  if public._city_is_mb_election(race.office::text, race.state) then
    ceiling := public._city_npc_campaign_ceiling(npc.election_id);
    if new_total > ceiling then
      new_total := ceiling;
      new_base := greatest(0::numeric, ceiling - speech_sum);
    end if;
  end if;

  update public.election_candidates
  set campaign_points_total = new_total,
      npc_base_campaign_points = new_base,
      npc_last_speech_at = now()
  where id = p_npc_candidate;

  return true;
end;
$$;

create or replace function public.tick_npc_campaigns(p_election_id uuid default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  npc_id uuid;
  n int := 0;
  race_id uuid;
begin
  for npc_id in
    select ec.id
    from public.election_candidates ec
    join public.elections e on e.id = ec.election_id
    where coalesce(ec.is_npc, false) = true
      and e.phase = 'general'
      and (e.general_closes_at is null or now() <= e.general_closes_at)
      and (p_election_id is null or e.id = p_election_id)
      and not public._election_has_recent_player_campaign(e.id)
  loop
    if public._npc_deliver_scheduled_speech(npc_id) then
      n := n + 1;
    elsif public._npc_deliver_scheduled_ad(npc_id) then
      n := n + 1;
    end if;
  end loop;

  if p_election_id is not null then
    perform public._cap_city_npc_campaign_advantage(p_election_id);
  else
    for race_id in
      select distinct e.id
      from public.elections e
      where e.phase = 'general'
        and public._city_is_mb_election(e.office::text, e.state)
    loop
      perform public._cap_city_npc_campaign_advantage(race_id);
    end loop;
  end if;

  return n;
end;
$$;

-- Backfill inflated city NPC totals to the new ceiling.
do $$
declare
  r record;
begin
  for r in
    select distinct e.id as election_id
    from public.elections e
    join public.election_candidates ec on ec.election_id = e.id
    where public._city_is_mb_election(e.office::text, e.state)
      and coalesce(ec.is_npc, false) = true
  loop
    perform public._cap_city_npc_campaign_advantage(r.election_id);
  end loop;
end;
$$;

grant execute on function public._city_npc_starting_points(text, numeric, text) to authenticated, service_role;
grant execute on function public._city_npc_campaign_ceiling(uuid) to authenticated, service_role;
grant execute on function public._cap_city_npc_campaign_advantage(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
