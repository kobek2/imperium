-- Fix enum/text mismatch when seeding party NPC placeholders.

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
  office_text text;
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

  office_text := race.office::text;

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
    p_election_id, 'democrat', lean, office_text, race.state, race.district_code,
    district_row.incumbent_party, district_row.incumbent_npc_name
  );
  rep_id := public._npc_insert_party_placeholder(
    p_election_id, 'republican', lean, office_text, race.state, race.district_code,
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

notify pgrst, 'reload schema';
