-- Persistent NPC politicians for every House district and Senate seat (reused across elections).

create table if not exists public.sim_politicians (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  character_name text not null,
  party text not null check (party in ('democrat', 'republican')),
  bio text not null default '',
  face_claim_url text,
  office text not null check (office in ('house', 'senate')),
  district_code text references public.districts (code) on delete cascade,
  state_code char(2) references public.states (code) on delete cascade,
  senate_class smallint check (senate_class is null or senate_class between 1 and 2),
  constraint sim_politicians_seat_shape check (
    (office = 'house' and district_code is not null and state_code is null and senate_class is null)
    or (office = 'senate' and district_code is null and state_code is not null and senate_class is not null)
  )
);

create unique index if not exists sim_politicians_house_party_idx
  on public.sim_politicians (district_code, party)
  where office = 'house';

create unique index if not exists sim_politicians_senate_party_idx
  on public.sim_politicians (state_code, senate_class, party)
  where office = 'senate';

alter table public.districts
  add column if not exists incumbent_politician_id uuid references public.sim_politicians (id) on delete set null;

create table if not exists public.senate_seats (
  state_code char(2) not null references public.states (code) on delete cascade,
  senate_class smallint not null check (senate_class between 1 and 2),
  incumbent_politician_id uuid references public.sim_politicians (id) on delete set null,
  incumbent_party char(1) check (incumbent_party is null or incumbent_party in ('D', 'R')),
  primary key (state_code, senate_class)
);

alter table public.election_candidates
  add column if not exists sim_politician_id uuid references public.sim_politicians (id) on delete set null;

alter table public.sim_politicians enable row level security;
alter table public.senate_seats enable row level security;

drop policy if exists "sim_politicians readable" on public.sim_politicians;
create policy "sim_politicians readable" on public.sim_politicians for select using (true);

drop policy if exists "senate_seats readable" on public.senate_seats;
create policy "senate_seats readable" on public.senate_seats for select using (true);

-- ---------- Seed roster (10 House districts × 2 parties + 6 Senate seats × 2 parties) ----------

insert into public.sim_politicians (slug, character_name, party, bio, face_claim_url, office, district_code, state_code, senate_class) values
  ('ne-01-dem', 'Rep. Marcus Chen', 'democrat',
   'Former state legislator from the Northeast & Midwest. Chairs the regional infrastructure caucus and campaigns on transit and manufacturing jobs.',
   'https://upload.wikimedia.org/wikipedia/commons/a/a6/Rep-Hakeem-Jeffries-Official-Portrait_%28cropped%29.jpg',
   'house', 'NE-01', null, null),
  ('ne-01-rep', 'Patricia O''Sullivan', 'republican',
   'County prosecutor turned congressional challenger. Emphasizes fiscal restraint and rural broadband expansion.',
   'https://upload.wikimedia.org/wikipedia/commons/7/79/Katherine_Clark%2C_official_portrait%2C_118th_Congress_%28tight_crop%29.jpg',
   'house', 'NE-01', null, null),
  ('ne-02-dem', 'Rep. Carmen Reyes', 'democrat',
   'Second-term representative focused on healthcare access and clean-energy tax credits for factory towns.',
   'https://upload.wikimedia.org/wikipedia/commons/4/4f/Patty_Murray%2C_official_portrait%2C_113th_Congress.jpg',
   'house', 'NE-02', null, null),
  ('ne-02-rep', 'Thomas Whitmore', 'republican',
   'Small-business owner and Army veteran running on regulatory relief and workforce training grants.',
   'https://upload.wikimedia.org/wikipedia/commons/d/dc/John_Thune%2C_official_portrait%2C_111th_Congress.jpg',
   'house', 'NE-02', null, null),
  ('ne-03-dem', 'Sandra Okonkwo', 'democrat',
   'Public defender and civil-rights attorney challenging for the Northeast & Midwest''s third district.',
   'https://upload.wikimedia.org/wikipedia/commons/7/75/Deb_Haaland%2C_official_portrait%2C_116th_Congress.jpg',
   'house', 'NE-03', null, null),
  ('ne-03-rep', 'Rep. Jackson Reeves', 'republican',
   'Incumbent conservative voice on agriculture policy and border-state commerce committees.',
   'https://upload.wikimedia.org/wikipedia/commons/b/b3/John_Barrasso%2C_official_portrait%2C_112th_Congress.jpg',
   'house', 'NE-03', null, null),
  ('so-01-dem', 'Michelle Carter', 'democrat',
   'Former school superintendent campaigning on teacher pay and hurricane-resilience funding.',
   'https://upload.wikimedia.org/wikipedia/commons/5/5d/Tom_Emmer%2C_official_portrait_114th_Congress_%283x4%29.jpg',
   'house', 'SO-01', null, null),
  ('so-01-rep', 'Rep. William Dalton', 'republican',
   'Incumbent South region representative known for defense appropriations and veterans'' clinics.',
   'https://upload.wikimedia.org/wikipedia/commons/3/34/Steve_Scalise_116th_Congress_official_photo.jpg',
   'house', 'SO-01', null, null),
  ('so-02-dem', 'Angela Prescott', 'democrat',
   'Hospital administrator highlighting Medicaid expansion and rural hospital stabilization.',
   'https://upload.wikimedia.org/wikipedia/commons/a/a8/Dick_Durbin_2022_official_portrait_%28cropped%29.jpg',
   'house', 'SO-02', null, null),
  ('so-02-rep', 'Rep. Robert Haynes', 'republican',
   'Incumbent focused on energy exports, port modernization, and law-enforcement grants.',
   'https://upload.wikimedia.org/wikipedia/commons/b/b9/Mike_Johnson_official_portrait%2C_118th_Congress.jpg',
   'house', 'SO-02', null, null),
  ('so-03-dem', 'Rep. David Kim', 'democrat',
   'Incumbent progressive organizer turned lawmaker; leads voting-rights and census oversight work.',
   'https://upload.wikimedia.org/wikipedia/commons/8/89/Chuck_Schumer_official_photo.jpg',
   'house', 'SO-03', null, null),
  ('so-03-rep', 'Richard Boone', 'republican',
   'Rancher and former state senator running on property-tax caps and water-rights reform.',
   'https://upload.wikimedia.org/wikipedia/commons/4/4f/Patty_Murray%2C_official_portrait%2C_113th_Congress.jpg',
   'house', 'SO-03', null, null),
  ('we-01-dem', 'Rep. Laura Nguyen', 'democrat',
   'Incumbent West region representative; tech-policy advocate and public-lands conservation lead.',
   'https://upload.wikimedia.org/wikipedia/commons/a/a6/Rep-Hakeem-Jeffries-Official-Portrait_%28cropped%29.jpg',
   'house', 'WE-01', null, null),
  ('we-01-rep', 'Christopher Vale', 'republican',
   'Wildfire mitigation consultant campaigning on forest management and water storage.',
   'https://upload.wikimedia.org/wikipedia/commons/d/dc/John_Thune%2C_official_portrait%2C_111th_Congress.jpg',
   'house', 'WE-01', null, null),
  ('we-02-dem', 'Rep. Sophia Martinez', 'democrat',
   'Incumbent labor attorney focused on housing affordability and minimum-wage harmonization.',
   'https://upload.wikimedia.org/wikipedia/commons/7/79/Katherine_Clark%2C_official_portrait%2C_118th_Congress_%28tight_crop%29.jpg',
   'house', 'WE-02', null, null),
  ('we-02-rep', 'Gregory Lance', 'republican',
   'Commercial pilot and municipal council member running on airport expansion and tourism.',
   'https://upload.wikimedia.org/wikipedia/commons/b/b3/John_Barrasso%2C_official_portrait%2C_112th_Congress.jpg',
   'house', 'WE-02', null, null),
  ('we-03-dem', 'Isabel Torres', 'democrat',
   'Climate scientist and university dean challenging on renewable-grid investment.',
   'https://upload.wikimedia.org/wikipedia/commons/7/75/Deb_Haaland%2C_official_portrait%2C_116th_Congress.jpg',
   'house', 'WE-03', null, null),
  ('we-03-rep', 'Rep. Nathan Brooks', 'republican',
   'Incumbent West district conservative; ranking member on energy and mineral resources.',
   'https://upload.wikimedia.org/wikipedia/commons/3/34/Steve_Scalise_116th_Congress_official_photo.jpg',
   'house', 'WE-03', null, null),
  ('we-04-dem', 'Rep. Jordan Pierce', 'democrat',
   'Incumbent coastal representative pushing fisheries policy and offshore-wind permitting reform.',
   'https://upload.wikimedia.org/wikipedia/commons/8/89/Chuck_Schumer_official_photo.jpg',
   'house', 'WE-04', null, null),
  ('we-04-rep', 'Megan Sullivan', 'republican',
   'Harbor commissioner emphasizing maritime trade, Coast Guard funding, and port security.',
   'https://upload.wikimedia.org/wikipedia/commons/5/5d/Tom_Emmer%2C_official_portrait_114th_Congress_%283x4%29.jpg',
   'house', 'WE-04', null, null),
  ('ne-s1-dem', 'Sen. Catherine Walsh', 'democrat',
   'Senior Northeast & Midwest senator; former governor and architect of the region''s rail-corridor compact.',
   'https://upload.wikimedia.org/wikipedia/commons/4/4f/Patty_Murray%2C_official_portrait%2C_113th_Congress.jpg',
   'senate', null, 'NE', 1),
  ('ne-s1-rep', 'George Brennan', 'republican',
   'Manufacturing executive challenging on trade enforcement and apprenticeship tax credits.',
   'https://upload.wikimedia.org/wikipedia/commons/d/dc/John_Thune%2C_official_portrait%2C_111th_Congress.jpg',
   'senate', null, 'NE', 1),
  ('ne-s2-dem', 'Lydia Park', 'democrat',
   'State treasurer campaigning for student-loan refinancing and regional development bonds.',
   'https://upload.wikimedia.org/wikipedia/commons/a/a8/Dick_Durbin_2022_official_portrait_%28cropped%29.jpg',
   'senate', null, 'NE', 2),
  ('ne-s2-rep', 'Sen. Harold Finch', 'republican',
   'Incumbent Northeast & Midwest senator known for defense readiness and Great Lakes shipping policy.',
   'https://upload.wikimedia.org/wikipedia/commons/b/b3/John_Barrasso%2C_official_portrait%2C_112th_Congress.jpg',
   'senate', null, 'NE', 2),
  ('so-s1-dem', 'Vanessa Morgan', 'democrat',
   'Civil-rights lawyer and former lieutenant governor running on healthcare and voting access.',
   'https://upload.wikimedia.org/wikipedia/commons/7/75/Deb_Haaland%2C_official_portrait%2C_116th_Congress.jpg',
   'senate', null, 'SO', 1),
  ('so-s1-rep', 'Sen. Clayton Hayes', 'republican',
   'Incumbent South senator; chairs the regional energy export caucus.',
   'https://upload.wikimedia.org/wikipedia/commons/b/b9/Mike_Johnson_official_portrait%2C_118th_Congress.jpg',
   'senate', null, 'SO', 1),
  ('so-s2-dem', 'James O''Connor', 'democrat',
   'Former mayor focused on flood insurance reform and FEMA modernization.',
   'https://upload.wikimedia.org/wikipedia/commons/a/a6/Rep-Hakeem-Jeffries-Official-Portrait_%28cropped%29.jpg',
   'senate', null, 'SO', 2),
  ('so-s2-rep', 'Sen. Diane Russell', 'republican',
   'Incumbent South class-II senator; leads appropriations work on military bases and shipyards.',
   'https://upload.wikimedia.org/wikipedia/commons/3/34/Steve_Scalise_116th_Congress_official_photo.jpg',
   'senate', null, 'SO', 2),
  ('we-s1-dem', 'Sen. Rachel Stein', 'democrat',
   'Incumbent West senator and former attorney general; national voice on privacy and antitrust.',
   'https://upload.wikimedia.org/wikipedia/commons/7/79/Katherine_Clark%2C_official_portrait%2C_118th_Congress_%28tight_crop%29.jpg',
   'senate', null, 'WE', 1),
  ('we-s1-rep', 'Paul Everett', 'republican',
   'Timber-industry executive campaigning on federal-lands access and wildfire liability reform.',
   'https://upload.wikimedia.org/wikipedia/commons/5/5d/Tom_Emmer%2C_official_portrait_114th_Congress_%283x4%29.jpg',
   'senate', null, 'WE', 1),
  ('we-s2-dem', 'Sen. Naomi Hughes', 'democrat',
   'Incumbent West class-II senator; advocates for semiconductor fabs and drought resilience.',
   'https://upload.wikimedia.org/wikipedia/commons/8/89/Chuck_Schumer_official_photo.jpg',
   'senate', null, 'WE', 2),
  ('we-s2-rep', 'Tyler Cohen', 'republican',
   'Venture investor running on permitting reform and federal research commercialization.',
   'https://upload.wikimedia.org/wikipedia/commons/d/dc/John_Thune%2C_official_portrait%2C_111th_Congress.jpg',
   'senate', null, 'WE', 2)
on conflict (slug) do update set
  character_name = excluded.character_name,
  party = excluded.party,
  bio = excluded.bio,
  face_claim_url = excluded.face_claim_url,
  office = excluded.office,
  district_code = excluded.district_code,
  state_code = excluded.state_code,
  senate_class = excluded.senate_class;

-- Wire House incumbents from district lean.
update public.districts d
set
  incumbent_politician_id = sp.id,
  incumbent_npc_name = sp.character_name
from public.sim_politicians sp
where sp.office = 'house'
  and sp.district_code = d.code
  and sp.party = case d.incumbent_party when 'D' then 'democrat' when 'R' then 'republican' else sp.party end;

insert into public.senate_seats (state_code, senate_class, incumbent_politician_id, incumbent_party) values
  ('NE', 1, (select id from public.sim_politicians where slug = 'ne-s1-dem'), 'D'),
  ('NE', 2, (select id from public.sim_politicians where slug = 'ne-s2-rep'), 'R'),
  ('SO', 1, (select id from public.sim_politicians where slug = 'so-s1-rep'), 'R'),
  ('SO', 2, (select id from public.sim_politicians where slug = 'so-s2-rep'), 'R'),
  ('WE', 1, (select id from public.sim_politicians where slug = 'we-s1-dem'), 'D'),
  ('WE', 2, (select id from public.sim_politicians where slug = 'we-s2-dem'), 'D')
on conflict (state_code, senate_class) do update set
  incumbent_politician_id = excluded.incumbent_politician_id,
  incumbent_party = excluded.incumbent_party;

update public.states s
set
  incumbent_npc_name = ss.incumbent_name,
  incumbent_party = ss.incumbent_party
from (
  select
    seat.state_code,
    sp.character_name as incumbent_name,
    seat.incumbent_party
  from public.senate_seats seat
  join public.sim_politicians sp on sp.id = seat.incumbent_politician_id
  where seat.senate_class = 1
) ss
where s.code = ss.state_code;

-- ---------- Resolve roster politician for a seat + party ----------

create or replace function public._sim_politician_for_seat(
  p_office text,
  p_district text,
  p_state text,
  p_senate_class smallint,
  p_party text
)
returns public.sim_politicians
language sql
stable
as $$
  select sp.*
  from public.sim_politicians sp
  where sp.party = p_party
    and (
      (p_office = 'house' and sp.office = 'house' and sp.district_code = p_district)
      or (
        p_office = 'senate'
        and sp.office = 'senate'
        and sp.state_code = p_state
        and sp.senate_class = p_senate_class
      )
    )
  limit 1;
$$;

create or replace function public._incumbent_politician_for_race(
  p_office text,
  p_district text,
  p_state text,
  p_senate_class smallint
)
returns public.sim_politicians
language sql
stable
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
    else null
  end
  limit 1;
$$;

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
     and trim(p_incumbent_name) <> ''
     and lower(trim(p_incumbent_name)) <> 'open seat' then
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

create or replace function public._apply_npc_seat_placeholder(e_election uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  race record;
  cand record;
  party_code char(1);
  npc_label text;
begin
  select e.winner_candidate_id, e.office, e.district_code, e.state, e.senate_class
    into race
    from public.elections e
    where e.id = e_election;

  if race.winner_candidate_id is null then
    return;
  end if;

  select ec.is_npc, ec.npc_name, ec.party, ec.sim_politician_id
    into cand
    from public.election_candidates ec
    where ec.id = race.winner_candidate_id;

  if not found or not coalesce(cand.is_npc, false) then
    return;
  end if;

  party_code := public._party_to_incumbent_code(cand.party);
  npc_label := coalesce(nullif(trim(cand.npc_name), ''), 'Incumbent');

  if race.office = 'house' and race.district_code is not null then
    update public.districts d
    set
      incumbent_npc_name = npc_label,
      incumbent_party = party_code,
      incumbent_politician_id = cand.sim_politician_id,
      claimed_by = null
    where d.code = race.district_code;
  elsif race.office = 'senate' and race.state is not null and race.senate_class is not null then
    insert into public.senate_seats (state_code, senate_class, incumbent_politician_id, incumbent_party)
    values (race.state, race.senate_class, cand.sim_politician_id, party_code)
    on conflict (state_code, senate_class) do update set
      incumbent_politician_id = excluded.incumbent_politician_id,
      incumbent_party = excluded.incumbent_party;

    update public.states s
    set
      incumbent_npc_name = npc_label,
      incumbent_party = party_code
    where s.code = race.state
      and race.senate_class = 1;
  end if;
end;
$$;

notify pgrst, 'reload schema';
