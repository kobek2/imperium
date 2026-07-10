-- City elections: seed opposing-party NPCs during primary when a player filed alone
-- (mirrors federal dual-party placeholders; skip NPC for parties that already have a player).

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
  npc_pts := public._npc_party_points(p_party, p_lean, p_incumbent_party);
  npc_votes := 10 + public._npc_favored_party_bonus(p_party, p_lean, p_incumbent_party);

  insert into public.election_candidates (
    election_id, user_id, party, is_npc, npc_name, sim_politician_id,
    npc_synthetic_votes, campaign_points_total, npc_base_campaign_points, primary_winner
  ) values (
    p_election_id, null, p_party, true, npc_label, pol.id,
    npc_votes, npc_pts, npc_pts, nominee_now
  )
  returning id into new_id;

  return new_id;
end;
$$;

create or replace function public._city_seed_competitive_npc_opponents(p_election_id uuid)
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
  else
    return false;
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
    return public._city_seed_competitive_npc_opponents(p_election_id);
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

  if public._city_is_mb_election(race.office::text, race.state) then
    perform public._city_seed_competitive_npc_opponents(p_election_id);
  else
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
end;
$$;

notify pgrst, 'reload schema';
