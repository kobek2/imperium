-- City election competitiveness: cap NPC starting advantage at +15, +3 pts every 3h, council ward closeout lean.

create or replace function public._npc_party_points(
  p_party text,
  p_lean numeric,
  p_incumbent_party text default null
)
returns numeric
language sql
immutable
as $$
  select 40::numeric + case
    when p_incumbent_party is not null and (
      (lower(trim(p_incumbent_party)) in ('d', 'dem', 'democrat') and p_party = 'democrat')
      or (lower(trim(p_incumbent_party)) in ('r', 'rep', 'republican') and p_party = 'republican')
      or lower(trim(p_incumbent_party)) = lower(trim(p_party))
    ) then 15
    when p_incumbent_party is null
      and (
        (p_party = 'democrat' and coalesce(p_lean, 0) > 0)
        or (p_party = 'republican' and coalesce(p_lean, 0) < 0)
      ) then 15
    else 0
  end;
$$;

create or replace function public._npc_favored_party_bonus(
  p_party text,
  p_lean numeric,
  p_incumbent_party text default null
)
returns numeric
language sql
immutable
as $$
  select case
    when p_incumbent_party is not null and (
      (lower(trim(p_incumbent_party)) in ('d', 'dem', 'democrat') and p_party = 'democrat')
      or (lower(trim(p_incumbent_party)) in ('r', 'rep', 'republican') and p_party = 'republican')
      or lower(trim(p_incumbent_party)) = lower(trim(p_party))
    ) then 5
    when p_incumbent_party is null
      and (
        (p_party = 'democrat' and coalesce(p_lean, 0) > 0)
        or (p_party = 'republican' and coalesce(p_lean, 0) < 0)
      ) then 5
    else 0
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
begin
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

  select e.senate_class into race_senate_class from public.elections e where e.id = p_election_id;

  select * into pol from public._sim_politician_for_seat(
    p_office, p_district, p_state, race_senate_class, p_party, p_ward
  );

  npc_label := coalesce(
    pol.character_name,
    public._npc_party_label(p_office, p_state, p_district, p_party, p_incumbent_party, p_incumbent_name, p_ward)
  );
  npc_pts := public._npc_party_points(p_party, p_lean, p_incumbent_party);
  npc_votes := 10 + public._npc_favored_party_bonus(p_party, p_lean, p_incumbent_party);

  insert into public.election_candidates (
    election_id, user_id, party, is_npc, npc_name, sim_politician_id,
    npc_synthetic_votes, campaign_points_total, npc_base_campaign_points, primary_winner
  ) values (
    p_election_id, null, p_party, true, npc_label, pol.id,
    npc_votes, npc_pts, npc_pts, false
  )
  returning id into new_id;

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

  select e.id, e.phase, e.general_closes_at
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

  update public.election_candidates
  set campaign_points_total = coalesce(npc_base_campaign_points, campaign_points_total) + (
      select coalesce(sum(points_delta), 0)
      from public.npc_campaign_actions
      where npc_candidate_id = p_npc_candidate
        and action_type = 'speech'
        and succeeded
    ),
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
  return n;
end;
$$;

create or replace function public._close_general_for_election(e_election uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  race record;
  district_pvi numeric := 0;
  state_pvi numeric := 0;
  ward_pvi numeric := 0;
  has_primary boolean;
  cand record;
  camp_total numeric := 0;
  vote_total numeric := 0;
  best_id uuid := null;
  best_score numeric := -1;
  cand_score numeric;
  cand_points numeric;
  cand_votes numeric;
  cand_lean numeric;
  winner_user uuid := null;
  active_count numeric := 0;
begin
  select e.office, e.district_code, e.state, e.ward_code
    into race
    from public.elections e
    where e.id = e_election;
  if not found then
    return;
  end if;

  perform public.seed_election_npc_opponents(e_election);
  perform public.tick_npc_campaigns(e_election);

  if race.office = 'council_ward' and race.ward_code is not null then
    select coalesce(w.pvi, 0)::numeric into ward_pvi
      from public.wards w
      where w.code = race.ward_code;
  elsif race.office = 'house' and race.district_code is not null then
    select coalesce(d.pvi, 0)::numeric into district_pvi
      from public.districts d
      where d.code = race.district_code;
  elsif race.office = 'senate' and race.state is not null then
    select coalesce(s.pvi, 0)::numeric into state_pvi
      from public.states s
      where s.code = race.state;
  end if;

  select exists(
    select 1 from public.election_candidates ec
    where ec.election_id = e_election and ec.primary_winner is true
  ) into has_primary;

  if not has_primary then
    perform public.finalize_election_party_nominees(e_election);
    has_primary := true;
  end if;

  select count(*)::numeric into active_count
    from public.election_candidates ec
    where ec.election_id = e_election
      and (has_primary = false or ec.primary_winner is true);

  if active_count < 1 then
    perform public.seed_election_npc_opponents(e_election);
    perform public.finalize_election_party_nominees(e_election);
    select count(*)::numeric into active_count
      from public.election_candidates ec
      where ec.election_id = e_election and ec.primary_winner is true;
  end if;

  for cand in
    select ec.id, ec.party, coalesce(ec.campaign_points_total, 0) as pts,
           coalesce(ec.npc_synthetic_votes, 0) as synth_votes
    from public.election_candidates ec
    where ec.election_id = e_election
      and (has_primary = false or ec.primary_winner is true)
  loop
    cand_lean := 0;
    if race.office = 'council_ward' then
      if cand.party = 'democrat' then cand_lean := ward_pvi;
      elsif cand.party = 'republican' then cand_lean := -1 * ward_pvi;
      end if;
    elsif race.office = 'house' then
      if cand.party = 'democrat' then cand_lean := district_pvi;
      elsif cand.party = 'republican' then cand_lean := -1 * district_pvi;
      end if;
    elsif race.office = 'senate' then
      if cand.party = 'democrat' then cand_lean := state_pvi;
      elsif cand.party = 'republican' then cand_lean := -1 * state_pvi;
      end if;
    end if;
    camp_total := camp_total + greatest(0, cand.pts + cand_lean);

    select coalesce(cand.synth_votes, 0) + count(*)::numeric into cand_votes
      from public.general_votes gv
      where gv.election_id = e_election and gv.candidate_id = cand.id;
    vote_total := vote_total + coalesce(cand_votes, 0);
  end loop;

  for cand in
    select ec.id, ec.user_id, ec.party, ec.is_npc,
           coalesce(ec.campaign_points_total, 0) as pts,
           coalesce(ec.npc_synthetic_votes, 0) as synth_votes,
           ec.created_at
    from public.election_candidates ec
    where ec.election_id = e_election
      and (has_primary = false or ec.primary_winner is true)
    order by ec.created_at nulls last, ec.id
  loop
    cand_lean := 0;
    if race.office = 'council_ward' then
      if cand.party = 'democrat' then cand_lean := ward_pvi;
      elsif cand.party = 'republican' then cand_lean := -1 * ward_pvi;
      end if;
    elsif race.office = 'house' then
      if cand.party = 'democrat' then cand_lean := district_pvi;
      elsif cand.party = 'republican' then cand_lean := -1 * district_pvi;
      end if;
    elsif race.office = 'senate' then
      if cand.party = 'democrat' then cand_lean := state_pvi;
      elsif cand.party = 'republican' then cand_lean := -1 * state_pvi;
      end if;
    end if;
    cand_points := greatest(0, cand.pts + cand_lean);

    select coalesce(cand.synth_votes, 0) + count(*)::numeric into cand_votes
      from public.general_votes gv
      where gv.election_id = e_election and gv.candidate_id = cand.id;

    cand_score :=
      0.6 * (case when camp_total > 0 then cand_points / camp_total
                  else 1.0 / nullif(active_count, 0) end)
      + 0.4 * (case when vote_total > 0 then cand_votes / vote_total
                    else 1.0 / nullif(active_count, 0) end);

    if cand_score > best_score
       or (cand_score = best_score and best_id is null) then
      best_score := cand_score;
      best_id := cand.id;
      if coalesce(cand.is_npc, false) then
        winner_user := null;
      else
        winner_user := cand.user_id;
      end if;
    end if;
  end loop;

  if best_id is null and active_count > 0 then
    select ec.id, ec.user_id, ec.is_npc
      into cand
      from public.election_candidates ec
      where ec.election_id = e_election
        and ec.primary_winner is true
      order by ec.created_at nulls last, ec.id
      limit 1;
    if found then
      best_id := cand.id;
      winner_user := case when coalesce(cand.is_npc, false) then null else cand.user_id end;
      best_score := 0;
    end if;
  end if;

  if best_id is not null then
    update public.election_candidates ec
      set final_score = best_score
      where ec.id = best_id;

    update public.elections
      set phase = 'closed'::public.election_phase,
          winner_user_id = winner_user,
          winner_candidate_id = best_id
      where id = e_election;

    perform public._apply_election_role_transitions(e_election);
  end if;
end;
$$;

grant execute on function public._npc_party_points(text, numeric, text) to authenticated, service_role;
grant execute on function public._npc_favored_party_bonus(text, numeric, text) to authenticated, service_role;

notify pgrst, 'reload schema';
