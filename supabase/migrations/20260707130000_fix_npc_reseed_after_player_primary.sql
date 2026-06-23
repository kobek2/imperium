-- Stop re-inserting party NPC placeholders after a player wins the primary.

create or replace function public._npc_insert_party_placeholder(
  p_election_id uuid,
  p_party text,
  p_lean numeric,
  p_office text,
  p_state text,
  p_district text,
  p_incumbent_party text,
  p_incumbent_name text,
  p_incumbent_politician_id uuid default null
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

  -- A seated player nominee already won this party's primary — never add another NPC.
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

  -- General election: if a real candidate filed for this party, they are the nominee.
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

  select e.senate_class into race_senate_class
  from public.elections e
  where e.id = p_election_id;

  select * into pol
  from public._sim_politician_for_seat(p_office, p_district, p_state, race_senate_class, p_party);

  npc_label := coalesce(
    pol.character_name,
    public._npc_party_label(
      p_office, p_state, p_district, p_party, p_incumbent_party, p_incumbent_name
    )
  );
  npc_pts := public._npc_party_points(p_party, p_lean);
  npc_votes := greatest(10, 18 + abs(coalesce(p_lean, 0)) * 2);

  insert into public.election_candidates (
    election_id,
    user_id,
    party,
    is_npc,
    npc_name,
    sim_politician_id,
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
    pol.id,
    npc_votes,
    npc_pts,
    npc_pts,
    false
  )
  returning id into new_id;

  return new_id;
end;
$$;

create or replace function public._purge_stale_party_npcs(p_election_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  removed int;
begin
  with doomed as (
    select ec.id
    from public.election_candidates ec
    where ec.election_id = p_election_id
      and coalesce(ec.is_npc, false) = true
      and (
        exists (
          select 1
          from public.election_candidates pw
          where pw.election_id = p_election_id
            and pw.party = ec.party
            and coalesce(pw.is_npc, false) = false
            and pw.primary_winner is true
        )
        or (
          exists (
            select 1 from public.elections e
            where e.id = p_election_id and e.phase = 'general'::public.election_phase
          )
          and exists (
            select 1
            from public.election_candidates pw
            where pw.election_id = p_election_id
              and pw.party = ec.party
              and coalesce(pw.is_npc, false) = false
          )
        )
      )
  )
  delete from public.election_candidates ec
  using doomed d
  where ec.id = d.id;

  get diagnostics removed = row_count;
  return removed;
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
  select e.id, e.office, e.state, e.district_code, e.senate_class, e.leadership_role, e.phase, e.npc_opponents_seeded
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

  perform public._purge_stale_party_npcs(p_election_id);

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
  end if;

  select * into inc_pol
  from public._incumbent_politician_for_race(
    office_text, race.district_code, race.state, race.senate_class
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
    incumbent_party, incumbent_name, incumbent_politician_id
  );
  rep_id := public._npc_insert_party_placeholder(
    p_election_id, 'republican', lean, office_text, race.state, race.district_code,
    incumbent_party, incumbent_name, incumbent_politician_id
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

-- One-time cleanup for races already polluted by re-seeded NPCs.
select public._purge_stale_party_npcs(e.id)
from public.elections e
where e.phase in ('primary', 'general')
  and e.leadership_role is null;

notify pgrst, 'reload schema';
