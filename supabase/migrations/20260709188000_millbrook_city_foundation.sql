-- Millbrook city simulator: single moderate city (7 wards), mayor + council offices,
-- lite city budget, department heads, election role transitions.

-- ---------- Geography ----------

create table if not exists public.cities (
  code char(2) primary key,
  name text not null,
  tagline text not null default ''
);

create table if not exists public.wards (
  code text primary key,
  city_code char(2) not null references public.cities (code) on delete cascade,
  ward_number smallint not null check (ward_number between 1 and 99),
  name text not null,
  pvi numeric not null default 0,
  incumbent_party char(1) not null check (incumbent_party in ('D', 'R')),
  incumbent_npc_name text not null default 'Open seat',
  incumbent_politician_id uuid references public.sim_politicians (id) on delete set null,
  claimed_by uuid references auth.users (id) on delete set null,
  unique (city_code, ward_number)
);

alter table public.wards enable row level security;
drop policy if exists "wards readable" on public.wards;
create policy "wards readable" on public.wards for select using (true);

insert into public.cities (code, name, tagline) values
  ('MB', 'Millbrook', 'A fictional moderate city — your local polsim sandbox.')
on conflict (code) do update set name = excluded.name, tagline = excluded.tagline;

insert into public.states (code, name, region) values
  ('MB', 'Millbrook', 'northeast_midwest')
on conflict (code) do update set name = excluded.name;

-- ---------- elections: city office shape (enum values in 20260709187500) ----------

alter table public.elections
  add column if not exists ward_code text references public.wards (code) on delete set null;

alter table public.elections drop constraint if exists elections_check;
alter table public.elections add constraint elections_check check (
  (office = 'house' and district_code is not null and state is not null and ward_code is null)
  or (office = 'senate' and state is not null and senate_class is not null and district_code is null and ward_code is null)
  or (office = 'president' and state is null and district_code is null and ward_code is null)
  or (office = 'mayor' and state = 'MB' and district_code is null and ward_code is null and senate_class is null)
  or (office = 'council_ward' and ward_code is not null and state = 'MB' and district_code is null and senate_class is null)
);

-- ---------- sim_politicians: council + mayor ----------

alter table public.sim_politicians drop constraint if exists sim_politicians_office_check;
alter table public.sim_politicians add constraint sim_politicians_office_check
  check (office in ('house', 'senate', 'council', 'mayor'));

alter table public.sim_politicians
  add column if not exists ward_code text references public.wards (code) on delete cascade;

alter table public.sim_politicians drop constraint if exists sim_politicians_seat_shape;
alter table public.sim_politicians add constraint sim_politicians_seat_shape check (
  (office = 'house' and district_code is not null and state_code is null and senate_class is null and ward_code is null)
  or (office = 'senate' and district_code is null and state_code is not null and senate_class is not null and ward_code is null)
  or (office = 'council' and ward_code is not null and district_code is null and state_code is null and senate_class is null)
  or (office = 'mayor' and ward_code is null and district_code is null and state_code is null and senate_class is null)
);

create unique index if not exists sim_politicians_council_party_idx
  on public.sim_politicians (ward_code, party)
  where office = 'council';

create unique index if not exists sim_politicians_mayor_party_idx
  on public.sim_politicians (party)
  where office = 'mayor';

create table if not exists public.mayor_seat (
  city_code char(2) primary key references public.cities (code) on delete cascade,
  incumbent_politician_id uuid references public.sim_politicians (id) on delete set null,
  incumbent_party char(1) check (incumbent_party is null or incumbent_party in ('D', 'R'))
);

alter table public.mayor_seat enable row level security;
drop policy if exists "mayor_seat readable" on public.mayor_seat;
create policy "mayor_seat readable" on public.mayor_seat for select using (true);

-- ---------- City departments (NPC heads appointed by mayor) ----------

create table if not exists public.city_department_heads (
  department_key text primary key check (department_key in (
    'finance', 'police', 'public_works', 'parks', 'planning'
  )),
  sim_politician_id uuid references public.sim_politicians (id) on delete set null,
  appointed_by uuid references auth.users (id) on delete set null,
  appointed_at timestamptz
);

alter table public.city_department_heads enable row level security;
drop policy if exists "city_department_heads read" on public.city_department_heads;
create policy "city_department_heads read" on public.city_department_heads for select to authenticated using (true);

-- ---------- Lite city budget ----------

create table if not exists public.city_budgets (
  id uuid primary key default gen_random_uuid(),
  fiscal_year smallint not null default 1,
  status text not null default 'draft' check (status in ('draft', 'proposed', 'council_vote', 'enacted', 'rejected')),
  proposed_by uuid references auth.users (id) on delete set null,
  council_yeas smallint not null default 0,
  council_nays smallint not null default 0,
  created_at timestamptz not null default now(),
  enacted_at timestamptz
);

create table if not exists public.city_budget_lines (
  budget_id uuid not null references public.city_budgets (id) on delete cascade,
  department_key text not null check (department_key in ('finance', 'police', 'public_works', 'parks', 'planning')),
  amount_millions numeric not null default 0 check (amount_millions >= 0),
  primary key (budget_id, department_key)
);

alter table public.city_budgets enable row level security;
alter table public.city_budget_lines enable row level security;
drop policy if exists "city_budgets read" on public.city_budgets;
create policy "city_budgets read" on public.city_budgets for select to authenticated using (true);
drop policy if exists "city_budget_lines read" on public.city_budget_lines;
create policy "city_budget_lines read" on public.city_budget_lines for select to authenticated using (true);

-- ---------- Seed Millbrook wards (4D / 3R) ----------

insert into public.wards (code, city_code, ward_number, name, pvi, incumbent_party, incumbent_npc_name) values
  ('W01', 'MB', 1, 'Downtown', 3, 'D', 'Councilor Elena Vasquez'),
  ('W02', 'MB', 2, 'Northside', 5, 'D', 'Councilor James Okoro'),
  ('W03', 'MB', 3, 'West End', -2, 'R', 'Councilor Patricia Hahn'),
  ('W04', 'MB', 4, 'Eastgate', 1, 'D', 'Councilor Miguel Santos'),
  ('W05', 'MB', 5, 'Riverside', -4, 'R', 'Councilor Robert Chen'),
  ('W06', 'MB', 6, 'Hillcrest', -3, 'R', 'Councilor Diane Foster'),
  ('W07', 'MB', 7, 'Lakeside', 2, 'D', 'Councilor Sarah Kim')
on conflict (code) do update set
  name = excluded.name,
  pvi = excluded.pvi,
  incumbent_party = excluded.incumbent_party,
  incumbent_npc_name = excluded.incumbent_npc_name;

-- Council NPC roster (2 per ward for elections)
insert into public.sim_politicians (slug, character_name, party, bio, office, ward_code) values
  ('w01-dem', 'Councilor Elena Vasquez', 'democrat', 'Incumbent downtown ward leader focused on transit-oriented development and small-business grants.', 'council', 'W01'),
  ('w01-rep', 'Mark Delaney', 'republican', 'Chamber of commerce president running on parking reform and streamlined permits.', 'council', 'W01'),
  ('w02-dem', 'Councilor James Okoro', 'democrat', 'Former school board chair campaigning on youth programs and library funding.', 'council', 'W02'),
  ('w02-rep', 'Helen Price', 'republican', 'Retired police sergeant emphasizing public safety and neighborhood watch expansion.', 'council', 'W02'),
  ('w03-dem', 'Angela Wu', 'democrat', 'Urban planner highlighting affordable housing and inclusionary zoning.', 'council', 'W03'),
  ('w03-rep', 'Councilor Patricia Hahn', 'republican', 'Incumbent West End voice on property-tax caps and business licensing.', 'council', 'W03'),
  ('w04-dem', 'Councilor Miguel Santos', 'democrat', 'Incumbent Eastgate organizer on community gardens and stormwater upgrades.', 'council', 'W04'),
  ('w04-rep', 'Tom Bradley', 'republican', 'Contractor advocating infrastructure bonds and road resurfacing priorities.', 'council', 'W04'),
  ('w05-dem', 'Lisa Nguyen', 'democrat', 'Hospital administrator running on clinic access and mental-health crisis teams.', 'council', 'W05'),
  ('w05-rep', 'Councilor Robert Chen', 'republican', 'Incumbent Riverside conservative on fiscal restraint and police staffing.', 'council', 'W05'),
  ('w06-dem', 'David Park', 'democrat', 'Teacher union rep pushing class-size relief and after-school funding.', 'council', 'W06'),
  ('w06-rep', 'Councilor Diane Foster', 'republican', 'Incumbent Hillcrest advocate for senior services and snow removal.', 'council', 'W06'),
  ('w07-dem', 'Councilor Sarah Kim', 'democrat', 'Incumbent Lakeside lead on lakefront parks and greenway trails.', 'council', 'W07'),
  ('w07-rep', 'Greg Morrison', 'republican', 'Real-estate broker emphasizing zoning stability and homeowner tax relief.', 'council', 'W07'),
  ('mayor-dem', 'Mayor Anita Reeves', 'democrat', 'First-term moderate mayor balancing development with neighborhood preservation.', 'mayor', null),
  ('mayor-rep', 'Victor Lang', 'republican', 'Former council spokesperson challenging on budget discipline and police retention.', 'mayor', null)
on conflict (slug) do update set
  character_name = excluded.character_name,
  party = excluded.party,
  bio = excluded.bio,
  office = excluded.office,
  ward_code = excluded.ward_code;

update public.wards w
set incumbent_politician_id = sp.id
from public.sim_politicians sp
where sp.office = 'council'
  and sp.ward_code = w.code
  and sp.party = case w.incumbent_party when 'D' then 'democrat' when 'R' then 'republican' end;

insert into public.mayor_seat (city_code, incumbent_politician_id, incumbent_party) values
  ('MB', (select id from public.sim_politicians where slug = 'mayor-dem'), 'D')
on conflict (city_code) do update set
  incumbent_politician_id = excluded.incumbent_politician_id,
  incumbent_party = excluded.incumbent_party;

-- Default NPC department heads (replaced when mayor appoints)
insert into public.city_department_heads (department_key, sim_politician_id) values
  ('finance', (select id from public.sim_politicians where slug = 'w04-dem')),
  ('police', (select id from public.sim_politicians where slug = 'w05-rep')),
  ('public_works', (select id from public.sim_politicians where slug = 'w03-rep')),
  ('parks', (select id from public.sim_politicians where slug = 'w07-dem')),
  ('planning', (select id from public.sim_politicians where slug = 'w01-dem'))
on conflict (department_key) do nothing;

alter table public.simulation_settings
  add column if not exists campaign_mayor_sim_id uuid references public.sim_politicians (id) on delete set null;

-- ---------- NPC party-line vote helper ----------

create or replace function public._npc_party_line_vote(
  p_voter_party text,
  p_bill_party text,
  p_candidate_party text default null
)
returns text
language sql
immutable
as $$
  select case
    when p_candidate_party is not null then
      case when p_voter_party = p_candidate_party then 'yea' else 'nay' end
    else
      case when p_voter_party = p_bill_party then 'yea' else 'nay' end
  end;
$$;

-- ---------- Seat resolution for city elections ----------

create or replace function public._sim_politician_for_seat(
  p_office text,
  p_district text,
  p_state text,
  p_senate_class smallint,
  p_party text,
  p_ward text default null
)
returns public.sim_politicians
language sql
stable
set search_path = public
as $$
  select sp.*
  from public.sim_politicians sp
  where sp.party = p_party
    and (
      (p_office = 'house' and sp.office = 'house' and sp.district_code = p_district)
      or (p_office = 'senate' and sp.office = 'senate' and sp.state_code = p_state and sp.senate_class = p_senate_class)
      or (p_office = 'council_ward' and sp.office = 'council' and sp.ward_code = p_ward)
      or (p_office = 'mayor' and sp.office = 'mayor')
    )
  limit 1;
$$;

create or replace function public._incumbent_politician_for_race(
  p_office text,
  p_district text,
  p_state text,
  p_senate_class smallint,
  p_ward text default null
)
returns public.sim_politicians
language sql
stable
set search_path = public
as $$
  select sp.*
  from public.sim_politicians sp
  where sp.id = case
    when p_office = 'house' then (
      select d.incumbent_politician_id from public.districts d where d.code = p_district
    )
    when p_office = 'senate' then (
      select seat.incumbent_politician_id
      from public.senate_seats seat
      where seat.state_code = p_state and seat.senate_class = p_senate_class
    )
    when p_office = 'council_ward' then (
      select w.incumbent_politician_id from public.wards w where w.code = p_ward
    )
    when p_office = 'mayor' then (
      select ms.incumbent_politician_id from public.mayor_seat ms where ms.city_code = 'MB'
    )
    else null
  end
  limit 1;
$$;

-- ---------- Election role transitions (mayor / council) ----------

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
  select id, office, state, district_code, ward_code, senate_class, phase, winner_user_id, roles_applied_at
    into race
    from public.elections
    where id = e_election;
  if not found then return; end if;
  if race.phase <> 'closed'::public.election_phase then return; end if;
  if race.roles_applied_at is not null then return; end if;

  leadership := array[
    'council_spokesperson',
    'speaker', 'house_majority_leader', 'house_majority_whip',
    'house_minority_leader', 'house_minority_whip',
    'senate_majority_leader', 'senate_majority_whip',
    'senate_minority_leader', 'senate_minority_whip',
    'president_pro_tempore'
  ];

  if race.office = 'mayor' then
    winner_role := 'mayor';
    incompat := array['council_member', 'representative', 'senator', 'president', 'vice_president'];
  elsif race.office = 'council_ward' then
    winner_role := 'council_member';
    incompat := array['mayor', 'representative', 'senator', 'president', 'vice_president'];
  elsif race.office = 'house' then
    winner_role := 'representative';
    incompat := array['senator', 'president', 'vice_president', 'mayor', 'council_member'];
  elsif race.office = 'senate' then
    winner_role := 'senator';
    incompat := array['representative', 'president', 'vice_president', 'mayor', 'council_member'];
  else
    winner_role := 'president';
    incompat := array['representative', 'senator', 'vice_president', 'mayor', 'council_member'];
  end if;

  if race.winner_user_id is not null then
    delete from public.government_role_grants g
      where g.user_id = race.winner_user_id
        and (g.role_key = any(leadership) or g.role_key = any(incompat));

    insert into public.government_role_grants (user_id, role_key)
      values (race.winner_user_id, winner_role)
      on conflict (user_id, role_key) do nothing;

    update public.profiles p
      set office_role = winner_role,
          home_district_code = case
            when race.office = 'council_ward' then coalesce(race.ward_code, p.home_district_code)
            else p.home_district_code
          end,
          residence_state = case
            when race.office in ('mayor', 'council_ward') then 'MB'
            else p.residence_state
          end,
          updated_at = now()
      where p.id = race.winner_user_id;
  end if;

  for cand in
    select ec.user_id, pr.residence_state, pr.home_district_code, pr.office_role
    from public.election_candidates ec
    left join public.profiles pr on pr.id = ec.user_id
    where ec.election_id = e_election
      and (race.winner_user_id is null or ec.user_id <> race.winner_user_id)
  loop
    if race.office = 'council_ward' then
      if upper(coalesce(cand.home_district_code, '')) = upper(coalesce(race.ward_code, ''))
         or upper(coalesce(cand.residence_state, '')) = 'MB' then
        delete from public.government_role_grants g
          where g.user_id = cand.user_id and g.role_key = 'council_member';
        update public.profiles p
          set office_role = null, updated_at = now()
          where p.id = cand.user_id and p.office_role = 'council_member';
      end if;
    elsif race.office = 'mayor' then
      delete from public.government_role_grants g
        where g.user_id = cand.user_id and g.role_key = 'mayor';
      update public.profiles p
        set office_role = null, updated_at = now()
        where p.id = cand.user_id and p.office_role = 'mayor';
    elsif race.office = 'house' then
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

-- ---------- Leadership sessions: council chamber + spokesperson ----------

alter table public.leadership_sessions drop constraint if exists leadership_sessions_chamber_check;
alter table public.leadership_sessions add constraint leadership_sessions_chamber_check
  check (chamber in ('house', 'senate', 'council'));

alter table public.leadership_session_candidates drop constraint if exists leadership_session_candidates_role_valid;
alter table public.leadership_session_candidates add constraint leadership_session_candidates_role_valid check (
  role in (
    'council_spokesperson',
    'speaker', 'house_majority_leader', 'house_majority_whip',
    'house_minority_leader', 'house_minority_whip',
    'senate_majority_leader', 'senate_majority_whip',
    'senate_minority_leader', 'senate_minority_whip',
    'president_pro_tempore'
  )
);

drop index if exists public.leadership_sessions_one_open_per_chamber;
create unique index if not exists leadership_sessions_one_open_per_chamber
  on public.leadership_sessions (chamber)
  where phase = 'open';

-- ---------- Mayor appoint department head ----------

create or replace function public.mayor_appoint_department_head(
  p_department text,
  p_sim_politician_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  dept text := lower(trim(coalesce(p_department, '')));
  sp record;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not exists (
    select 1 from public.government_role_grants g
    where g.user_id = v_uid and g.role_key in ('mayor', 'admin')
  ) and not public.is_staff_admin(v_uid) then
    raise exception 'Only the mayor may appoint department heads';
  end if;
  if dept not in ('finance', 'police', 'public_works', 'parks', 'planning') then
    raise exception 'Invalid department';
  end if;
  select * into sp from public.sim_politicians where id = p_sim_politician_id;
  if sp.id is null then raise exception 'Politician not found'; end if;

  insert into public.city_department_heads (department_key, sim_politician_id, appointed_by, appointed_at)
  values (dept, p_sim_politician_id, v_uid, now())
  on conflict (department_key) do update set
    sim_politician_id = excluded.sim_politician_id,
    appointed_by = excluded.appointed_by,
    appointed_at = excluded.appointed_at;

  delete from public.sim_government_role_grants g where g.role_key = 'dept_' || dept;
  insert into public.sim_government_role_grants (sim_politician_id, role_key)
  values (p_sim_politician_id, 'dept_' || dept)
  on conflict (role_key) do update set sim_politician_id = excluded.sim_politician_id;

  return jsonb_build_object('ok', true, 'department', dept, 'sim_id', p_sim_politician_id);
end;
$$;

grant execute on function public.mayor_appoint_department_head(text, uuid) to authenticated;

notify pgrst, 'reload schema';
