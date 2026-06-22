-- Every seat race seeds Democrat + Republican NPC placeholders.
-- Players win party primaries via primary_votes; winners replace their party's NPC.
-- General election is two nominees (player or NPC per party), points-only.

create unique index if not exists election_candidates_one_npc_per_party
  on public.election_candidates (election_id, party)
  where is_npc = true;

create or replace function public._npc_party_label(
  p_office text,
  p_state text,
  p_district text,
  p_party text,
  p_incumbent_party text,
  p_incumbent_name text
)
returns text
language plpgsql
immutable
as $$
declare
  label text;
begin
  if p_incumbent_party = p_party
     and p_incumbent_name is not null
     and trim(p_incumbent_name) <> '' then
    return trim(p_incumbent_name);
  end if;

  if p_office = 'house' and p_district is not null then
    return case p_party
      when 'democrat' then 'Democratic Nominee'
      when 'republican' then 'Republican Nominee'
      else 'Independent Nominee'
    end;
  elsif p_office = 'senate' and p_state is not null then
    label := coalesce(nullif(trim(p_state), ''), 'State');
    return label || ' ' || case p_party
      when 'democrat' then 'Democrat'
      when 'republican' then 'Republican'
      else 'Independent'
    end;
  elsif p_office = 'president' then
    return case p_party
      when 'democrat' then 'Democratic Nominee'
      when 'republican' then 'Republican Nominee'
      else 'Independent Nominee'
    end;
  end if;

  return case p_party
    when 'democrat' then 'Democratic Nominee'
    when 'republican' then 'Republican Nominee'
    else 'Independent Nominee'
  end;
end;
$$;

create or replace function public._npc_party_points(p_party text, p_lean numeric)
returns numeric
language sql
immutable
as $$
  select greatest(25, 30 + abs(coalesce(p_lean, 0)) * 4)
    + case
        when (p_party = 'democrat' and coalesce(p_lean, 0) > 0)
          or (p_party = 'republican' and coalesce(p_lean, 0) < 0) then 15
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
  p_incumbent_name text
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
begin
  select ec.id into existing_id
  from public.election_candidates ec
  where ec.election_id = p_election_id
    and ec.party = p_party
    and coalesce(ec.is_npc, false) = true
  limit 1;

  if existing_id is not null then
    return existing_id;
  end if;

  npc_label := public._npc_party_label(
    p_office, p_state, p_district, p_party, p_incumbent_party, p_incumbent_name
  );
  npc_pts := public._npc_party_points(p_party, p_lean);
  npc_votes := greatest(10, 18 + abs(coalesce(p_lean, 0)) * 2);

  insert into public.election_candidates (
    election_id,
    user_id,
    party,
    is_npc,
    npc_name,
    npc_synthetic_votes,
    campaign_points_total,
    npc_base_campaign_points,
    primary_winner
  ) values (
    p_election_id,
    null,
    p_party,
    true,
    npc_label,
    npc_votes,
    npc_pts,
    npc_pts,
    false
  )
  returning id into new_id;

  return new_id;
end;
$$;

-- Seed Democrat + Republican NPC placeholders (idempotent).
create or replace function public.seed_election_npc_opponents(p_election_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  race record;
  district_row record;
  lean numeric := 0;
  inserted boolean := false;
  dem_id uuid;
  rep_id uuid;
begin
  select e.id, e.office, e.state, e.district_code, e.leadership_role, e.phase, e.npc_opponents_seeded
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

  if race.office = 'house' and race.district_code is not null then
    select d.pvi, d.incumbent_party, d.incumbent_npc_name
      into district_row
      from public.districts d
      where d.code = race.district_code;
    lean := coalesce(district_row.pvi, 0);
  elsif race.office = 'senate' and race.state is not null then
    select coalesce(s.pvi, 0) into lean from public.states s where s.code = race.state;
    district_row.incumbent_party := null;
    district_row.incumbent_npc_name := null;
  else
    district_row.incumbent_party := null;
    district_row.incumbent_npc_name := null;
  end if;

  dem_id := public._npc_insert_party_placeholder(
    p_election_id, 'democrat', lean, race.office::text, race.state, race.district_code,
    district_row.incumbent_party, district_row.incumbent_npc_name
  );
  rep_id := public._npc_insert_party_placeholder(
    p_election_id, 'republican', lean, race.office::text, race.state, race.district_code,
    district_row.incumbent_party, district_row.incumbent_npc_name
  );

  if dem_id is not null or rep_id is not null then
    inserted := true;
  end if;

  update public.elections
  set npc_opponents_seeded = true
  where id = p_election_id;

  return inserted;
end;
$$;

-- Finalize nominees after primary: player winners replace party NPCs; empty parties keep NPC.
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
begin
  perform public.seed_election_npc_opponents(p_election_id);

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

create or replace function public._close_primary_for_election(e_election uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.finalize_election_party_nominees(e_election);

  update public.elections e
  set phase = 'general'::public.election_phase
  where e.id = e_election;
end;
$$;

revoke all on function public.finalize_election_party_nominees(uuid) from public;
grant execute on function public.finalize_election_party_nominees(uuid) to authenticated, service_role;

-- Opposite-party NPC nominee for reactive campaigning.
create or replace function public._npc_opponent_for_player(
  p_election uuid,
  p_player_candidate uuid
)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select ec.id
  from public.election_candidates ec
  join public.election_candidates player on player.id = p_player_candidate
  where ec.election_id = p_election
    and coalesce(ec.is_npc, false) = true
    and ec.party is distinct from player.party
    and (
      not exists (
        select 1 from public.election_candidates x
        where x.election_id = p_election and x.primary_winner is true
      )
      or ec.primary_winner is true
    )
  order by ec.created_at nulls last, ec.id
  limit 1;
$$;

notify pgrst, 'reload schema';
