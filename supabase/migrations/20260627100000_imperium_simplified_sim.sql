-- Imperium simplified sim: 3 regions (NE/SO/WE), 10 House districts, 2 Senate seats per region,
-- national President (no electoral college), economy without budget gate, manual elections.

-- ---------- Economy: no budget shutdown gate ----------
create or replace function public._economy_require_active_budget()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  null;
end;
$$;

-- ---------- Calendar off ----------
update public.simulation_settings
set
  calendar_is_active = false,
  calendar_auto_congress_elections = false
where id = 1;

-- ---------- Phase scheduler: manual-only (no automatic advances) ----------
create or replace function public.advance_election_phases_by_schedule()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  null;
end;
$$;

-- ---------- Clear elections before tightening senate seat constraint (class 3 → 2 seats) ----------
delete from public.general_votes;
delete from public.primary_votes;
delete from public.presidential_endorsement_allocations;
delete from public.campaign_speeches;
delete from public.campaign_rallies;
delete from public.campaign_endorsements;
delete from public.campaign_ads;
delete from public.election_candidates;
delete from public.elections;

-- ---------- Senate seats: 2 per region (was 3 per state) ----------
alter table public.elections drop constraint if exists elections_senate_class_check;
alter table public.elections
  add constraint elections_senate_class_check check (senate_class is null or senate_class between 1 and 2);

-- Remap profiles before deleting geography (FK: residence_state → states, home_district_code → districts).
update public.profiles
set home_district_code = null
where home_district_code is not null;

-- Ensure target region codes exist before remapping profile residence (SO/WE are new codes).
insert into public.states (code, name, region, senate_class, pvi) values
  ('NE', 'Northeast & Midwest', 'northeast_midwest', null, 0),
  ('SO', 'South', 'south', null, 0),
  ('WE', 'West', 'west', null, 0)
on conflict (code) do update set
  name = excluded.name,
  region = excluded.region,
  senate_class = excluded.senate_class,
  pvi = excluded.pvi;

update public.profiles p
set residence_state = case
  when upper(trim(coalesce(p.residence_state, ''))) in (
    'CT','IL','IN','IA','KS','ME','MA','MI','MN','MO','NE','NH','NJ','NY','ND','OH','PA','RI','SD','VT','WI','DC'
  ) then 'NE'
  when upper(trim(coalesce(p.residence_state, ''))) in (
    'AL','AR','DE','FL','GA','KY','LA','MD','MS','NC','OK','SC','TN','TX','VA','WV'
  ) then 'SO'
  when upper(trim(coalesce(p.residence_state, ''))) in ('NE', 'SO', 'WE') then upper(trim(p.residence_state))
  else 'WE'
end
where p.residence_state is not null;

delete from public.districts;
delete from public.states
where code not in ('NE', 'SO', 'WE');

alter table public.states drop constraint if exists states_senate_class_check;
alter table public.states
  add constraint states_senate_class_check check (senate_class is null or senate_class between 1 and 2);

insert into public.districts (code, state, district_number, pvi, incumbent_party, incumbent_npc_name) values
  ('NE-01', 'NE', 1, 0, 'D', 'Open seat'),
  ('NE-02', 'NE', 2, 0, 'D', 'Open seat'),
  ('NE-03', 'NE', 3, 0, 'R', 'Open seat'),
  ('SO-01', 'SO', 1, 0, 'R', 'Open seat'),
  ('SO-02', 'SO', 2, 0, 'R', 'Open seat'),
  ('SO-03', 'SO', 3, 0, 'D', 'Open seat'),
  ('WE-01', 'WE', 1, 0, 'D', 'Open seat'),
  ('WE-02', 'WE', 2, 0, 'D', 'Open seat'),
  ('WE-03', 'WE', 3, 0, 'R', 'Open seat'),
  ('WE-04', 'WE', 4, 0, 'D', 'Open seat');

update public.profiles p
set home_district_code = d.code
from public.districts d
where d.state = upper(trim(coalesce(p.residence_state, '')))
  and d.district_number = 1
  and p.residence_state is not null;

-- Senate role transitions: region code + seat 1 or 2
create or replace function public._apply_election_role_transitions(e_election uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  race record;
  cand record;
  winner_role text;
  incompat text[];
  leadership text[];
begin
  select id, office, state, district_code, senate_class, phase, winner_user_id, roles_applied_at
    into race
    from public.elections
    where id = e_election;
  if not found then
    return;
  end if;
  if race.phase <> 'closed'::public.election_phase then
    return;
  end if;
  if race.roles_applied_at is not null then
    return;
  end if;

  leadership := array[
    'speaker',
    'house_majority_leader', 'house_majority_whip',
    'house_minority_leader', 'house_minority_whip',
    'senate_majority_leader', 'senate_majority_whip',
    'senate_minority_leader', 'senate_minority_whip',
    'president_pro_tempore'
  ];

  if race.office = 'house' then
    winner_role := 'representative';
    incompat := array['senator', 'president', 'vice_president'];
  elsif race.office = 'senate' then
    winner_role := 'senator';
    incompat := array['representative', 'president', 'vice_president'];
  else
    winner_role := 'president';
    incompat := array['representative', 'senator', 'vice_president'];
  end if;

  if race.winner_user_id is not null then
    delete from public.government_role_grants g
      where g.user_id = race.winner_user_id
        and (g.role_key = any(leadership) or g.role_key = any(incompat));
    insert into public.government_role_grants (user_id, role_key)
      values (race.winner_user_id, winner_role)
      on conflict (user_id, role_key) do nothing;
    update public.profiles p
      set office_role = winner_role, updated_at = now()
      where p.id = race.winner_user_id
        and (
          p.office_role is null or p.office_role = 'citizen' or p.office_role = winner_role
          or p.office_role = any(incompat) or p.office_role = any(leadership)
        );
  end if;

  for cand in
    select ec.user_id, pr.residence_state, pr.home_district_code, pr.office_role
    from public.election_candidates ec
    left join public.profiles pr on pr.id = ec.user_id
    where ec.election_id = e_election
      and (race.winner_user_id is null or ec.user_id <> race.winner_user_id)
  loop
    if race.office = 'house' then
      if upper(coalesce(cand.home_district_code, '')) = upper(coalesce(race.district_code, '')) then
        delete from public.government_role_grants g where g.user_id = cand.user_id and g.role_key = 'representative';
        update public.profiles p set office_role = null, updated_at = now()
          where p.id = cand.user_id and p.office_role = 'representative';
      end if;
    elsif race.office = 'senate' then
      if upper(coalesce(cand.residence_state, '')) = upper(coalesce(race.state, '')) then
        delete from public.government_role_grants g where g.user_id = cand.user_id and g.role_key = 'senator';
        update public.profiles p set office_role = null, updated_at = now()
          where p.id = cand.user_id and p.office_role = 'senator';
      end if;
    elsif race.office = 'president' then
      delete from public.government_role_grants g where g.user_id = cand.user_id and g.role_key = 'president';
      update public.profiles p set office_role = null, updated_at = now()
        where p.id = cand.user_id and p.office_role = 'president';
    end if;
    delete from public.government_role_grants g
      where g.user_id = cand.user_id and g.role_key = any(leadership);
    update public.profiles p set office_role = null, updated_at = now()
      where p.id = cand.user_id and p.office_role = any(leadership);
  end loop;

  update public.elections set roles_applied_at = now() where id = e_election;
end;
$$;

-- President uses same 60/40 closeout as House/Senate (no electoral college).
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
begin
  select e.office, e.district_code, e.state
    into race
    from public.elections e
    where e.id = e_election;
  if not found then
    return;
  end if;

  if race.office = 'house' and race.district_code is not null then
    select coalesce(d.pvi, 0)::numeric into district_pvi from public.districts d where d.code = race.district_code;
  elsif race.office = 'senate' and race.state is not null then
    select coalesce(s.pvi, 0)::numeric into state_pvi from public.states s where s.code = race.state;
  end if;

  select exists(
    select 1 from public.election_candidates ec
    where ec.election_id = e_election and ec.primary_winner is true
  ) into has_primary;

  for cand in
    select ec.id, ec.party, coalesce(ec.campaign_points_total, 0) as pts, ec.user_id
    from public.election_candidates ec
    where ec.election_id = e_election
      and (has_primary = false or ec.primary_winner is true)
  loop
    cand_lean := 0;
    if race.office = 'house' then
      if cand.party = 'democrat' then cand_lean := district_pvi;
      elsif cand.party = 'republican' then cand_lean := -1 * district_pvi;
      end if;
    elsif race.office = 'senate' then
      if cand.party = 'democrat' then cand_lean := state_pvi;
      elsif cand.party = 'republican' then cand_lean := -1 * state_pvi;
      end if;
    end if;
    camp_total := camp_total + greatest(0, cand.pts + cand_lean);
    select count(*)::numeric into cand_votes from public.general_votes gv where gv.candidate_id = cand.id;
    vote_total := vote_total + cand_votes;
  end loop;

  for cand in
    select ec.id, ec.party, coalesce(ec.campaign_points_total, 0) as pts, ec.user_id
    from public.election_candidates ec
    where ec.election_id = e_election
      and (has_primary = false or ec.primary_winner is true)
  loop
    cand_lean := 0;
    if race.office = 'house' then
      if cand.party = 'democrat' then cand_lean := district_pvi;
      elsif cand.party = 'republican' then cand_lean := -1 * district_pvi;
      end if;
    elsif race.office = 'senate' then
      if cand.party = 'democrat' then cand_lean := state_pvi;
      elsif cand.party = 'republican' then cand_lean := -1 * state_pvi;
      end if;
    end if;
    cand_points := greatest(0, cand.pts + cand_lean);
    select count(*)::numeric into cand_votes from public.general_votes gv where gv.candidate_id = cand.id;
    cand_score := 0;
    if camp_total > 0 then cand_score := cand_score + 0.6 * (cand_points / camp_total); end if;
    if vote_total > 0 then cand_score := cand_score + 0.4 * (cand_votes / vote_total); end if;
    if cand_score > best_score then
      best_score := cand_score;
      best_id := cand.id;
      winner_user := cand.user_id;
    end if;
  end loop;

  if best_id is not null then
    update public.election_candidates ec set final_score = best_score where ec.id = best_id;
    update public.elections e
      set phase = 'closed'::public.election_phase, winner_user_id = winner_user
      where e.id = e_election;
    perform public._apply_election_role_transitions(e_election);
  end if;
end;
$$;

-- Senate appointment: region code NE/SO/WE + seat 1|2
create or replace function public.admin_appoint_senate_seat(p_user_id uuid, p_state text, p_class smallint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  leadership text[] := array[
    'speaker', 'house_majority_leader', 'house_majority_whip',
    'house_minority_leader', 'house_minority_whip',
    'senate_majority_leader', 'senate_majority_whip',
    'senate_minority_leader', 'senate_minority_whip', 'president_pro_tempore'
  ];
  incompat text[] := array['representative', 'president', 'vice_president'];
  st text := upper(trim(coalesce(p_state, '')));
  prior_uid uuid;
  res_state text;
begin
  if auth.uid() is null or not public.is_staff_admin(auth.uid()) then
    raise exception 'Admin only';
  end if;
  if st not in ('NE', 'SO', 'WE') then
    raise exception 'Region must be NE, SO, or WE.';
  end if;
  if p_class is null or p_class < 1 or p_class > 2 then
    raise exception 'Senate seat must be 1 or 2.';
  end if;

  select upper(trim(coalesce(p.residence_state, ''))) into res_state from public.profiles p where p.id = p_user_id;
  if res_state is null or res_state <> st then
    raise exception 'Profile residence region must match the Senate seat region.';
  end if;

  select e.winner_user_id into prior_uid
  from public.elections e
  where e.office = 'senate' and upper(trim(coalesce(e.state, ''))) = st
    and e.senate_class = p_class and e.phase = 'closed'::public.election_phase
    and e.winner_user_id is not null
  order by e.general_closes_at desc nulls last limit 1;

  if prior_uid is not null and prior_uid is distinct from p_user_id then
    delete from public.government_role_grants g where g.user_id = prior_uid and g.role_key = 'senator';
    update public.profiles p set office_role = null, updated_at = now()
      where p.id = prior_uid and p.office_role = 'senator';
  end if;

  delete from public.government_role_grants g
  where g.user_id = p_user_id and (g.role_key = any(leadership) or g.role_key = any(incompat));
  insert into public.government_role_grants (user_id, role_key) values (p_user_id, 'senator')
  on conflict (user_id, role_key) do nothing;
  update public.profiles p set office_role = 'senator', updated_at = now() where p.id = p_user_id;

  return jsonb_build_object('ok', true, 'region', st, 'seat', p_class);
end;
$$;

create or replace function public.admin_appoint_house_seat(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  leadership text[] := array[
    'speaker', 'house_majority_leader', 'house_majority_whip',
    'house_minority_leader', 'house_minority_whip',
    'senate_majority_leader', 'senate_majority_whip',
    'senate_minority_leader', 'senate_minority_whip', 'president_pro_tempore'
  ];
  incompat text[] := array['senator', 'president', 'vice_president'];
  district text;
begin
  if auth.uid() is null or not public.is_staff_admin(auth.uid()) then raise exception 'Admin only'; end if;
  select upper(trim(coalesce(p.home_district_code, ''))) into district from public.profiles p where p.id = p_user_id;
  if district is null or district !~ '^(NE|SO|WE)-[0-9]{2}$' then
    raise exception 'Profile needs a valid home district (e.g. NE-01) for a House appointment.';
  end if;
  delete from public.government_role_grants g using public.profiles p
  where g.user_id = p.id and g.role_key = 'representative'
    and upper(trim(coalesce(p.home_district_code, ''))) = district and g.user_id is distinct from p_user_id;
  update public.profiles p set office_role = null, updated_at = now()
  where upper(trim(coalesce(p.home_district_code, ''))) = district and p.office_role = 'representative' and p.id is distinct from p_user_id;
  delete from public.government_role_grants g where g.user_id = p_user_id and (g.role_key = any(leadership) or g.role_key = any(incompat));
  insert into public.government_role_grants (user_id, role_key) values (p_user_id, 'representative') on conflict do nothing;
  update public.profiles p set office_role = 'representative', updated_at = now() where p.id = p_user_id;
  return jsonb_build_object('ok', true, 'district', district);
end;
$$;

notify pgrst, 'reload schema';
