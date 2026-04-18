-- =====================================================================
-- POLSIM Command Center: paste this ENTIRE file into Supabase Dashboard → SQL Editor → Run.
-- PostgreSQL does not understand file paths like supabase/migrations/... — only SQL text.
-- Use on a fresh project (empty public schema). If you already partially applied migrations, reset or run files individually.
-- =====================================================================

-- PolSim Command Center — core schema
-- Run with Supabase CLI or paste into SQL editor.

create extension if not exists "pgcrypto";

-- ---------- Regions (presidential 40% community vote) ----------
create type public.us_region as enum ('northeast_midwest', 'south', 'west');

create table public.states (
  code char(2) primary key,
  name text not null,
  region public.us_region not null,
  senate_class smallint check (senate_class between 1 and 3),
  pvi numeric not null default 0,
  electoral_votes smallint not null default 0 check (electoral_votes >= 0)
);

-- ---------- Districts (House) ----------
create table public.districts (
  code text primary key,
  state char(2) not null references public.states(code),
  district_number smallint not null check (district_number >= 1),
  pvi numeric not null default 0,
  incumbent_party char(1) not null check (incumbent_party in ('D', 'R')),
  incumbent_npc_name text not null,
  claimed_by uuid references auth.users (id) on delete set null,
  unique (state, district_number)
);

-- ---------- Profiles (1:1 with Discord-authenticated user) ----------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  discord_user_id text unique not null,
  discord_username text,
  character_name text not null,
  date_of_birth date,
  residence_state char(2) references public.states(code),
  home_district_code text references public.districts(code),
  party text not null check (party in ('democrat', 'republican', 'independent')),
  bio text,
  face_claim_url text,
  former_positions text,
  office_role text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_discord_user_id_idx on public.profiles (discord_user_id);

-- ---------- Elections ----------
create type public.election_office as enum ('house', 'senate', 'president');
create type public.election_phase as enum ('filing', 'primary', 'general', 'closed');

create table public.elections (
  id uuid primary key default gen_random_uuid(),
  office public.election_office not null,
  state char(2) references public.states(code),
  district_code text references public.districts(code),
  senate_class smallint check (senate_class between 1 and 3),
  phase public.election_phase not null default 'filing',
  filing_opens_at timestamptz not null,
  filing_closes_at timestamptz not null,
  primary_closes_at timestamptz,
  general_closes_at timestamptz,
  winner_user_id uuid references auth.users (id),
  created_at timestamptz not null default now(),
  check (
    (office = 'house' and district_code is not null and state is not null)
    or (office = 'senate' and state is not null and senate_class is not null and district_code is null)
    or (office = 'president' and state is null and district_code is null)
  )
);

create table public.election_candidates (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references public.elections (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  party text not null check (party in ('democrat', 'republican', 'independent')),
  primary_winner boolean default false,
  campaign_points_total numeric not null default 0,
  community_vote_weight numeric default 0,
  final_score numeric,
  unique (election_id, user_id)
);

create table public.primary_votes (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references public.elections (id) on delete cascade,
  voter_id uuid not null references auth.users (id) on delete cascade,
  candidate_id uuid not null references public.election_candidates (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (election_id, voter_id)
);

create table public.general_votes (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references public.elections (id) on delete cascade,
  voter_id uuid not null references auth.users (id) on delete cascade,
  candidate_id uuid not null references public.election_candidates (id) on delete cascade,
  voter_state char(2) references public.states(code),
  created_at timestamptz not null default now(),
  unique (election_id, voter_id)
);

-- Presidential endorsement points allocated per state (cap enforced in app)
create table public.presidential_endorsement_allocations (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references public.elections (id) on delete cascade,
  candidate_id uuid not null references public.election_candidates (id) on delete cascade,
  state char(2) not null references public.states(code),
  points numeric not null check (points >= 0 and points <= 45),
  unique (election_id, candidate_id, state)
);

-- ---------- Congress ----------
create type public.bill_chamber as enum ('house', 'senate');
create type public.bill_status as enum (
  'hopper',
  'house_committee',
  'house_floor',
  'senate_committee',
  'senate_floor',
  'passed_congress',
  'oval',
  'law',
  'vetoed',
  'dead'
);

create table public.bills (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content_md text not null,
  originating_chamber public.bill_chamber not null,
  status public.bill_status not null default 'hopper',
  author_id uuid not null references auth.users (id) on delete cascade,
  rejected_by_speaker boolean default false,
  filibuster_active boolean default false,
  vp_tie_break_pending boolean default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  signed_at timestamptz,
  vetoed_at timestamptz,
  -- Leadership has 12h to schedule a hopper bill; the floor vote then runs 24h.
  -- Without these two columns, /congress/leadership can't read its queue and silently
  -- renders an empty inbox (bills still land in "hopper" fine).
  leadership_deadline_at timestamptz,
  chamber_vote_deadline_at timestamptz
);

create table public.bill_votes (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills (id) on delete cascade,
  voter_id uuid not null references auth.users (id) on delete cascade,
  chamber public.bill_chamber not null,
  vote text not null check (vote in ('yea', 'nay', 'abstain')),
  created_at timestamptz not null default now(),
  unique (bill_id, voter_id, chamber)
);

-- ---------- Executive / confirmations ----------
create type public.appointment_kind as enum ('cabinet', 'scotus', 'other');

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  kind public.appointment_kind not null,
  title text not null,
  nominee_user_id uuid not null references auth.users (id) on delete cascade,
  president_user_id uuid not null references auth.users (id) on delete cascade,
  confirmation_bill_id uuid references public.bills (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
  created_at timestamptz not null default now()
);

-- ---------- Seed: states + districts (435) ----------
insert into public.states (code, name, region, senate_class) values
  ('AL', 'Alabama', 'south', 2),
  ('AK', 'Alaska', 'west', 3),
  ('AZ', 'Arizona', 'west', 1),
  ('AR', 'Arkansas', 'south', 2),
  ('CA', 'California', 'west', 1),
  ('CO', 'Colorado', 'west', 2),
  ('CT', 'Connecticut', 'northeast_midwest', 1),
  ('DE', 'Delaware', 'south', 1),
  ('FL', 'Florida', 'south', 1),
  ('GA', 'Georgia', 'south', 2),
  ('HI', 'Hawaii', 'west', 3),
  ('ID', 'Idaho', 'west', 2),
  ('IL', 'Illinois', 'northeast_midwest', 2),
  ('IN', 'Indiana', 'northeast_midwest', 1),
  ('IA', 'Iowa', 'northeast_midwest', 2),
  ('KS', 'Kansas', 'northeast_midwest', 2),
  ('KY', 'Kentucky', 'south', 2),
  ('LA', 'Louisiana', 'south', 3),
  ('ME', 'Maine', 'northeast_midwest', 1),
  ('MD', 'Maryland', 'south', 1),
  ('MA', 'Massachusetts', 'northeast_midwest', 1),
  ('MI', 'Michigan', 'northeast_midwest', 1),
  ('MN', 'Minnesota', 'northeast_midwest', 2),
  ('MS', 'Mississippi', 'south', 2),
  ('MO', 'Missouri', 'northeast_midwest', 1),
  ('MT', 'Montana', 'west', 2),
  ('NE', 'Nebraska', 'northeast_midwest', 1),
  ('NV', 'Nevada', 'west', 3),
  ('NH', 'New Hampshire', 'northeast_midwest', 2),
  ('NJ', 'New Jersey', 'northeast_midwest', 1),
  ('NM', 'New Mexico', 'west', 2),
  ('NY', 'New York', 'northeast_midwest', 1),
  ('NC', 'North Carolina', 'south', 2),
  ('ND', 'North Dakota', 'northeast_midwest', 1),
  ('OH', 'Ohio', 'northeast_midwest', 3),
  ('OK', 'Oklahoma', 'south', 2),
  ('OR', 'Oregon', 'west', 2),
  ('PA', 'Pennsylvania', 'northeast_midwest', 1),
  ('RI', 'Rhode Island', 'northeast_midwest', 1),
  ('SC', 'South Carolina', 'south', 2),
  ('SD', 'South Dakota', 'northeast_midwest', 2),
  ('TN', 'Tennessee', 'south', 1),
  ('TX', 'Texas', 'south', 2),
  ('UT', 'Utah', 'west', 1),
  ('VT', 'Vermont', 'northeast_midwest', 1),
  ('VA', 'Virginia', 'south', 1),
  ('WA', 'Washington', 'west', 1),
  ('WV', 'West Virginia', 'south', 2),
  ('WI', 'Wisconsin', 'northeast_midwest', 1),
  ('WY', 'Wyoming', 'west', 2);

-- Apportionment-based district counts (118th Congress style; totals 435)
with seats(state, n) as (
  values
    ('AL', 7), ('AK', 1), ('AZ', 9), ('AR', 4), ('CA', 52), ('CO', 8), ('CT', 5), ('DE', 1),
    ('FL', 28), ('GA', 14), ('HI', 2), ('ID', 2), ('IL', 17), ('IN', 9), ('IA', 4), ('KS', 4),
    ('KY', 6), ('LA', 6), ('ME', 2), ('MD', 8), ('MA', 9), ('MI', 13), ('MN', 8), ('MS', 4),
    ('MO', 8), ('MT', 2), ('NE', 3), ('NV', 4), ('NH', 2), ('NJ', 12), ('NM', 3), ('NY', 26),
    ('NC', 14), ('ND', 1), ('OH', 15), ('OK', 5), ('OR', 6), ('PA', 17), ('RI', 2), ('SC', 7),
    ('SD', 1), ('TN', 9), ('TX', 38), ('UT', 4), ('VT', 1), ('VA', 11), ('WA', 10), ('WV', 2),
    ('WI', 8), ('WY', 1)
),
expanded as (
  select s.state, gs.n as district_number
  from seats s
  join lateral generate_series(1, s.n) as gs(n) on true
)
insert into public.districts (code, state, district_number, pvi, incumbent_party, incumbent_npc_name)
select
  e.state || '-' || lpad(e.district_number::text, 2, '0'),
  e.state::char(2),
  e.district_number::smallint,
  -- Deterministic pseudo-PVI from hash; replace with real Cook PVI data in production
  round(((('x' || substr(md5(e.state || e.district_number::text), 1, 8))::bit(32)::bigint % 61) - 30)::numeric, 1),
  case when (('x' || substr(md5(e.state || 'p' || e.district_number::text), 1, 8))::bit(32)::bigint % 2) = 0 then 'D' else 'R' end,
  'NPC Incumbent (' || e.state || '-' || lpad(e.district_number::text, 2, '0') || ')'
from expanded e;

-- ---------- RLS ----------
alter table public.profiles enable row level security;
alter table public.districts enable row level security;
alter table public.states enable row level security;
alter table public.elections enable row level security;
alter table public.election_candidates enable row level security;
alter table public.primary_votes enable row level security;
alter table public.general_votes enable row level security;
alter table public.presidential_endorsement_allocations enable row level security;
alter table public.bills enable row level security;
alter table public.bill_votes enable row level security;
alter table public.appointments enable row level security;

create policy "states readable" on public.states for select using (true);
create policy "districts readable" on public.districts for select using (true);
create policy "districts claim or release" on public.districts for update
  using (claimed_by is null or claimed_by = auth.uid())
  with check (claimed_by is null or claimed_by = auth.uid());

create policy "profiles read all authed" on public.profiles for select using (auth.role() = 'authenticated');
create policy "profiles insert self" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles update self" on public.profiles for update using (auth.uid() = id);

create policy "elections read" on public.elections for select using (auth.role() = 'authenticated');
create policy "candidates read" on public.election_candidates for select using (auth.role() = 'authenticated');
create policy "candidates insert self" on public.election_candidates for insert with check (auth.uid() = user_id);
create policy "primary votes insert self" on public.primary_votes for insert with check (auth.uid() = voter_id);
create policy "primary votes read" on public.primary_votes for select using (auth.role() = 'authenticated');
create policy "general votes insert self" on public.general_votes for insert with check (auth.uid() = voter_id);
create policy "general votes read" on public.general_votes for select using (auth.role() = 'authenticated');
create policy "endorse alloc read" on public.presidential_endorsement_allocations for select using (auth.role() = 'authenticated');
create policy "endorse alloc insert candidate" on public.presidential_endorsement_allocations for insert with check (
  exists (
    select 1 from public.election_candidates c
    where c.id = candidate_id and c.user_id = auth.uid()
  )
);
create policy "endorse alloc update candidate" on public.presidential_endorsement_allocations for update using (
  exists (
    select 1 from public.election_candidates c
    where c.id = candidate_id and c.user_id = auth.uid()
  )
);

create policy "bills read" on public.bills for select using (auth.role() = 'authenticated');
create policy "bills insert authed" on public.bills for insert with check (auth.uid() = author_id);
create policy "bill votes read" on public.bill_votes for select using (auth.role() = 'authenticated');
create policy "bill votes insert self" on public.bill_votes for insert with check (auth.uid() = voter_id);

create policy "appointments read" on public.appointments for select using (auth.role() = 'authenticated');

-- Auto profile row on signup (Discord id must be passed via trigger or app — placeholder trigger reads raw_user_meta_data)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, discord_user_id, discord_username, character_name, party)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data->>'provider_id', ''),
      nullif(new.raw_user_meta_data->>'sub', ''),
      new.id::text
    ),
    coalesce(new.raw_user_meta_data->>'preferred_username', new.raw_user_meta_data->>'user_name'),
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1), 'Citizen'),
    'independent'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- updated_at ----------
create or replace function public.touch_profiles()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_profiles();

-- --- 20260416000001_policies_extra ---
-- Additional RLS for leadership updates and appointments

create policy "bills update leadership or author" on public.bills for update
  using (
    author_id = auth.uid()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.office_role in (
          'speaker',
          'senate_majority_leader',
          'president',
          'vice_president',
          'admin'
        )
    )
  );

create policy "appointments insert president" on public.appointments for insert
  with check (
    president_user_id = auth.uid()
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.office_role in ('president', 'admin')
    )
  );

create policy "appointments update nominee status" on public.appointments for update
  using (
    nominee_user_id = auth.uid()
    or president_user_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.office_role = 'admin'
    )
  );

create policy "bill votes delete self" on public.bill_votes for delete
  using (voter_id = auth.uid());

-- --- 20260417000000_government_role_grants ---
-- One row per Discord-equivalent office/party/caucus role granted to a user.
-- The Discord bot (service role) should upsert rows when guild member roles change.

create table public.government_role_grants (
  user_id uuid not null references auth.users (id) on delete cascade,
  role_key text not null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role_key)
);

create index government_role_grants_user_id_idx on public.government_role_grants (user_id);

alter table public.government_role_grants enable row level security;

create policy "government_role_grants read own" on public.government_role_grants
  for select using (user_id = auth.uid());

-- No insert/update/delete for end users — only service role / dashboard bypasses RLS.

-- --- 20260417000001_expand_bills_rls_for_grants ---
-- Align bill / appointment updates with Discord-synced government_role_grants

drop policy if exists "bills update leadership or author" on public.bills;

create policy "bills update leadership or author" on public.bills for update
  using (
    author_id = auth.uid()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.office_role in (
          'speaker',
          'house_majority_leader',
          'house_majority_whip',
          'senate_majority_leader',
          'senate_majority_whip',
          'president_pro_tempore',
          'president',
          'vice_president',
          'admin'
        )
    )
    or exists (
      select 1
      from public.government_role_grants g
      where g.user_id = auth.uid()
        and g.role_key in (
          'speaker',
          'house_majority_leader',
          'house_majority_whip',
          'senate_majority_leader',
          'senate_majority_whip',
          'president_pro_tempore',
          'president',
          'vice_president',
          'admin'
        )
    )
  );

drop policy if exists "appointments insert president" on public.appointments;

create policy "appointments insert president" on public.appointments for insert
  with check (
    president_user_id = auth.uid()
    and (
      exists (
        select 1
        from public.profiles p
        where p.id = auth.uid()
          and p.office_role in ('president', 'admin')
      )
      or exists (
        select 1
        from public.government_role_grants g
        where g.user_id = auth.uid()
          and g.role_key in ('president', 'admin')
      )
    )
  );

-- --- 20260418120000_election_admin_rls ---
-- Admin-only mutations on elections and candidate rows (no SQL editor needed day-to-day)

create or replace function public.is_staff_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = uid and p.office_role = 'admin'
  )
  or exists (
    select 1 from public.government_role_grants g
    where g.user_id = uid and g.role_key = 'admin'
  );
$$;

grant execute on function public.is_staff_admin(uuid) to authenticated;

create policy "elections insert admin" on public.elections for insert
  with check (public.is_staff_admin(auth.uid()));

create policy "elections update admin" on public.elections for update
  using (public.is_staff_admin(auth.uid()));

create policy "elections delete admin" on public.elections for delete
  using (public.is_staff_admin(auth.uid()));

create policy "election_candidates update admin" on public.election_candidates for update
  using (public.is_staff_admin(auth.uid()));

create policy "election_candidates delete admin" on public.election_candidates for delete
  using (public.is_staff_admin(auth.uid()));

-- ---------- Seed states.pvi from 2024 presidential margins (positive = D lean) ----------
-- Without this, every Senate race starts 50/50 because _close_general_for_election() and the
-- web app both read states.pvi and get 0 for every state.
update public.states as s
set pvi = v.pvi
from (values
  ('AL', -30), ('AK', -13), ('AZ',  -5), ('AR', -21), ('CA',  20), ('CO',  11),
  ('CT',  14), ('DE',  15), ('DC',  86), ('FL', -13), ('GA',  -2), ('HI',  24),
  ('ID', -37), ('IL',  11), ('IN', -19), ('IA', -13), ('KS', -16), ('KY', -31),
  ('LA', -22), ('ME',   7), ('MD',  26), ('MA',  25), ('MI',  -1), ('MN',   4),
  ('MS', -23), ('MO', -18), ('MT', -20), ('NE', -21), ('NV',  -3), ('NH',   3),
  ('NJ',   6), ('NM',   6), ('NY',  12), ('NC',  -3), ('ND', -36), ('OH', -11),
  ('OK', -33), ('OR',  14), ('PA',  -2), ('RI',  14), ('SC', -18), ('SD', -29),
  ('TN', -23), ('TX', -14), ('UT', -22), ('VT',  32), ('VA',   6), ('WA',  20),
  ('WV', -42), ('WI',  -1), ('WY', -46)
) as v(code, pvi)
where s.code = v.code;

-- ---------- Seed states.electoral_votes from 2024 apportionment (538 total) ----------
-- Required for the presidential map + winner-take-all EC scoring.
update public.states as s
set electoral_votes = v.ev
from (values
  ('AL',  9), ('AK',  3), ('AZ', 11), ('AR',  6), ('CA', 54), ('CO', 10),
  ('CT',  7), ('DE',  3), ('DC',  3), ('FL', 30), ('GA', 16), ('HI',  4),
  ('ID',  4), ('IL', 19), ('IN', 11), ('IA',  6), ('KS',  6), ('KY',  8),
  ('LA',  8), ('ME',  4), ('MD', 10), ('MA', 11), ('MI', 15), ('MN', 10),
  ('MS',  6), ('MO', 10), ('MT',  4), ('NE',  5), ('NV',  6), ('NH',  4),
  ('NJ', 14), ('NM',  5), ('NY', 28), ('NC', 16), ('ND',  3), ('OH', 17),
  ('OK',  7), ('OR',  8), ('PA', 19), ('RI',  4), ('SC',  9), ('SD',  3),
  ('TN', 11), ('TX', 40), ('UT',  6), ('VT',  3), ('VA', 13), ('WA', 12),
  ('WV',  4), ('WI', 10), ('WY',  3)
) as v(code, ev)
where s.code = v.code;

-- ============================================================================
-- ---------- Leadership elections (migration 20260427000000) ----------
-- Chamber-wide races for Speaker, Majority / Minority Leader + Whip, and PPT.
-- Must run AFTER the base election schema above.
-- ============================================================================

-- Leadership elections: chamber-wide votes that decide who holds Speaker, Majority / Minority
-- Leader + Whip, and President Pro Tempore. These races look like regular elections but:
--
--   * No geographic slot (state / district / senate_class are all null).
--   * No primary phase — filing closes, and the general opens immediately.
--   * Winner selection is simple plurality of general_votes (no PVI, no campaign points).
--   * Role transition grants the leadership role_key WITHOUT revoking the winner's chamber
--     role (representative / senator). Losers keep their chamber role too; only the specific
--     leadership grant they were competing for is cleared from anyone who previously held it.
--
-- Ties: earliest filer wins, same tiebreak as the seat elections. Idempotent via
-- elections.roles_applied_at.

alter table public.elections
  add column if not exists leadership_role text,
  add column if not exists restricted_party text;

alter table public.elections
  drop constraint if exists elections_leadership_role_valid;
alter table public.elections
  add constraint elections_leadership_role_valid check (
    leadership_role is null
    or leadership_role in (
      'speaker',
      'house_majority_leader', 'house_majority_whip',
      'house_minority_leader', 'house_minority_whip',
      'senate_majority_leader', 'senate_majority_whip',
      'senate_minority_leader', 'senate_minority_whip',
      'president_pro_tempore'
    )
  );

alter table public.elections
  drop constraint if exists elections_restricted_party_valid;
alter table public.elections
  add constraint elections_restricted_party_valid check (
    restricted_party is null or restricted_party in ('democrat', 'republican', 'independent')
  );

-- The original check enforced that seat elections carry geography. Leadership races don't,
-- so we widen the constraint to allow leadership rows when leadership_role is set.
alter table public.elections
  drop constraint if exists elections_office_valid;
alter table public.elections
  drop constraint if exists elections_check;
alter table public.elections
  drop constraint if exists elections_check1;

alter table public.elections
  add constraint elections_office_valid check (
    (
      leadership_role is not null
      and state is null and district_code is null and senate_class is null
      and office in ('house', 'senate')
    )
    or (
      leadership_role is null
      and (
        (office = 'house'     and district_code is not null and state is not null)
        or (office = 'senate' and state is not null and senate_class is not null and district_code is null)
        or (office = 'president' and state is null and district_code is null)
      )
    )
  );

-- ---------- Role transitions ----------
-- Rewrite to branch on leadership_role. The original behaviour for seat elections is
-- preserved verbatim; the new branch only grants/revokes the specific leadership role
-- and never touches chamber roles.

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
  select id, office, state, district_code, senate_class, phase, winner_user_id,
         roles_applied_at, leadership_role
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

  -- ---- Branch A: leadership race. Chamber roles are untouched; only the specific
  --       leadership grant we're electing for is reassigned.
  if race.leadership_role is not null then
    if race.winner_user_id is not null then
      -- Every non-winner candidate in this race loses THIS leadership role (if they
      -- held it previously). Non-candidates keep whatever they already have.
      delete from public.government_role_grants g
        using public.election_candidates ec
       where ec.election_id = e_election
         and ec.user_id = g.user_id
         and ec.user_id <> race.winner_user_id
         and g.role_key = race.leadership_role;

      -- Also clear any prior holder of this role who isn't in this race (e.g. someone who
      -- didn't file for re-election). They lose the specific leadership grant; chamber
      -- role is unaffected.
      delete from public.government_role_grants g
       where g.role_key = race.leadership_role
         and g.user_id <> race.winner_user_id;

      -- Grant the leadership role_key to the winner. Upsert so re-election is a no-op.
      insert into public.government_role_grants (user_id, role_key)
        values (race.winner_user_id, race.leadership_role)
        on conflict (user_id, role_key) do nothing;
    else
      -- Race closed with no winner (e.g. no filers). Vacate the role.
      delete from public.government_role_grants g
       where g.role_key = race.leadership_role;
    end if;

    update public.elections
      set roles_applied_at = now()
      where id = e_election;
    return;
  end if;

  -- ---- Branch B: regular seat race. Preserves the original 20260423 behaviour.
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
      set office_role = winner_role,
          updated_at = now()
      where p.id = race.winner_user_id
        and (
          p.office_role is null
          or p.office_role = 'citizen'
          or p.office_role = winner_role
          or p.office_role = any(incompat)
          or p.office_role = any(leadership)
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
        delete from public.government_role_grants g
          where g.user_id = cand.user_id and g.role_key = 'representative';
        update public.profiles p
          set office_role = null, updated_at = now()
          where p.id = cand.user_id and p.office_role = 'representative';
      end if;
    elsif race.office = 'senate' then
      if upper(coalesce(cand.residence_state, '')) = upper(coalesce(race.state, '')) then
        delete from public.government_role_grants g
          where g.user_id = cand.user_id and g.role_key = 'senator';
        update public.profiles p
          set office_role = null, updated_at = now()
          where p.id = cand.user_id and p.office_role = 'senator';
      end if;
    elsif race.office = 'president' then
      delete from public.government_role_grants g
        where g.user_id = cand.user_id and g.role_key = 'president';
      update public.profiles p
        set office_role = null, updated_at = now()
        where p.id = cand.user_id and p.office_role = 'president';
    end if;

    delete from public.government_role_grants g
      where g.user_id = cand.user_id and g.role_key = any(leadership);
    update public.profiles p
      set office_role = null, updated_at = now()
      where p.id = cand.user_id and p.office_role = any(leadership);
  end loop;

  update public.elections
    set roles_applied_at = now()
    where id = e_election;
end;
$$;

-- ---------- Auto-close ----------
-- Leadership races use plain plurality of general_votes. Seat races keep the existing 60/40
-- scoring with PVI lean (copied verbatim from 20260425).

create or replace function public._close_general_for_election(e_election uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  race record;
  partisan_lean numeric := 0;
  has_primary boolean;
  cand record;
  camp_total numeric := 0;
  vote_total numeric := 0;
  best_user uuid := null;
  best_score numeric;
  best_created timestamptz;
  best_is_set boolean := false;
  cand_score numeric;
  cand_points numeric;
  cand_votes numeric;
  cand_lean numeric;
  active_count numeric;
begin
  select e.office, e.district_code, e.state, e.leadership_role
    into race
    from public.elections e
    where e.id = e_election;
  if not found then return; end if;

  -- Leadership: pure plurality, earliest-filer tiebreak.
  if race.leadership_role is not null then
    for cand in
      select ec.id, ec.user_id, ec.created_at
      from public.election_candidates ec
      where ec.election_id = e_election
      order by ec.created_at nulls last, ec.id
    loop
      select count(*)::numeric into cand_votes
        from public.general_votes gv
        where gv.election_id = e_election and gv.candidate_id = cand.id;

      if not best_is_set
         or cand_votes > best_score
         or (cand_votes = best_score and (best_created is null or cand.created_at < best_created))
      then
        best_score := cand_votes;
        best_user := cand.user_id;
        best_created := cand.created_at;
        best_is_set := true;
      end if;
    end loop;

    update public.elections
      set phase = 'closed'::public.election_phase,
          winner_user_id = best_user
      where id = e_election;

    perform public._apply_election_role_transitions(e_election);
    return;
  end if;

  if race.office = 'president' then return; end if;

  if race.office = 'house' and race.district_code is not null then
    select coalesce(d.pvi, 0)::numeric into partisan_lean
      from public.districts d
      where d.code = race.district_code;
  elsif race.office = 'senate' and race.state is not null then
    select coalesce(s.pvi, 0)::numeric into partisan_lean
      from public.states s
      where s.code = race.state;
  end if;
  if partisan_lean is null then partisan_lean := 0; end if;

  select exists(
    select 1 from public.election_candidates ec
    where ec.election_id = e_election and ec.primary_winner is true
  ) into has_primary;

  select count(*)::numeric into active_count
    from public.election_candidates ec
    where ec.election_id = e_election
      and (has_primary = false or ec.primary_winner is true);

  for cand in
    select ec.id, ec.party, coalesce(ec.campaign_points_total, 0) as pts
    from public.election_candidates ec
    where ec.election_id = e_election
      and (has_primary = false or ec.primary_winner is true)
  loop
    cand_lean := 0;
    if cand.party = 'democrat' then cand_lean := partisan_lean;
    elsif cand.party = 'republican' then cand_lean := -1 * partisan_lean;
    end if;
    camp_total := camp_total + greatest(0, cand.pts + cand_lean);

    select count(*)::numeric into cand_votes
      from public.general_votes gv
      where gv.election_id = e_election and gv.candidate_id = cand.id;
    vote_total := vote_total + cand_votes;
  end loop;

  for cand in
    select ec.id, ec.user_id, ec.party, ec.created_at, coalesce(ec.campaign_points_total, 0) as pts
    from public.election_candidates ec
    where ec.election_id = e_election
      and (has_primary = false or ec.primary_winner is true)
    order by ec.created_at nulls last, ec.id
  loop
    cand_lean := 0;
    if cand.party = 'democrat' then cand_lean := partisan_lean;
    elsif cand.party = 'republican' then cand_lean := -1 * partisan_lean;
    end if;
    cand_points := greatest(0, cand.pts + cand_lean);
    select count(*)::numeric into cand_votes
      from public.general_votes gv
      where gv.election_id = e_election and gv.candidate_id = cand.id;

    cand_score :=
      0.6 * (case
              when camp_total > 0 then cand_points / camp_total
              when active_count > 0 then 1.0 / active_count
              else 0
            end)
      + 0.4 * (case
              when vote_total > 0 then cand_votes / vote_total
              when active_count > 0 then 1.0 / active_count
              else 0
            end);

    if not best_is_set
       or cand_score > best_score
       or (cand_score = best_score and (best_created is null or cand.created_at < best_created))
    then
      best_score := cand_score;
      best_user := cand.user_id;
      best_created := cand.created_at;
      best_is_set := true;
    end if;
  end loop;

  if best_user is null then
    update public.elections
      set phase = 'closed'::public.election_phase
      where id = e_election;
    perform public._apply_election_role_transitions(e_election);
    return;
  end if;

  update public.elections
    set phase = 'closed'::public.election_phase,
        winner_user_id = best_user
    where id = e_election;

  perform public._apply_election_role_transitions(e_election);
end;
$$;

-- ---------- Phase scheduler ----------
-- Leadership races skip primary: when filing_closes_at passes they go straight to general.
-- Otherwise the scheduler matches the regular path.

create or replace function public.advance_election_phases_by_schedule()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  -- Seat races: filing -> primary when filing closes.
  update public.elections
  set phase = 'primary'::public.election_phase
  where phase = 'filing'::public.election_phase
    and leadership_role is null
    and filing_closes_at < now();

  -- Leadership races: filing -> general when filing closes (no primary).
  update public.elections
  set phase = 'general'::public.election_phase
  where phase = 'filing'::public.election_phase
    and leadership_role is not null
    and filing_closes_at < now();

  for r in
    select e.id
    from public.elections e
    where e.phase = 'primary'::public.election_phase
      and e.primary_closes_at is not null
      and e.primary_closes_at < now()
  loop
    perform public._close_primary_for_election(r.id);
  end loop;

  -- General auto-close covers House/Senate (seat races) and every leadership race. Presidential
  -- seat races still require admin certification.
  for r in
    select e.id
    from public.elections e
    where e.phase = 'general'::public.election_phase
      and e.general_closes_at is not null
      and e.general_closes_at < now()
      and (e.leadership_role is not null or e.office <> 'president')
  loop
    perform public._close_general_for_election(r.id);
  end loop;
end;
$$;

revoke all on function public._apply_election_role_transitions(uuid) from public;
revoke all on function public._close_general_for_election(uuid) from public;
revoke all on function public.advance_election_phases_by_schedule() from public;
grant execute on function public.advance_election_phases_by_schedule() to anon, authenticated;

comment on function public.advance_election_phases_by_schedule() is
  'Seat races: filing->primary->general->closed with 60/40 scoring. Leadership races (elections.leadership_role set): filing->general->closed by plain plurality.';

-- ============================================================================
-- ---------- Leadership sessions (migration 20260428000000) ----------
-- Admin-toggled 24h windows where the chamber files + votes simultaneously.
-- Supersedes the elections.leadership_role flow above.
-- ============================================================================

-- Leadership sessions: admin-toggled, chamber-wide filing + voting windows that decide who
-- holds Speaker, Majority / Minority Leader + Whip, and President Pro Tempore for one term.
--
-- Shape:
--   * Admin opens a session for a chamber. One open session per chamber at a time.
--   * Session runs for 24 hours by default (admin can end early).
--   * Members of the chamber may simultaneously file to run AND vote on each role during
--     the window. One filing per user per session (choose one role); one vote per role per
--     voter.
--   * Partisan roles (majority/minority leader + whip) are gated by the majority_party
--     captured at open time: "majority" = members of majority_party, "minority" = everyone
--     else who holds the chamber role. Speaker + PPT are chamber-wide.
--   * Close = per-role plurality. Tie = most senior member wins (earliest granted_at on
--     representative/senator role). Winner gets the leadership role_key in
--     government_role_grants; prior holder (if any) has just that leadership grant
--     revoked. Chamber roles (representative/senator) are never touched.
--
-- This supersedes the previous leadership-via-elections path (elections.leadership_role).
-- Those columns remain on public.elections but are no longer written from the UI.

-- ---------- Tables ----------

create table if not exists public.leadership_sessions (
  id uuid primary key default gen_random_uuid(),
  chamber text not null check (chamber in ('house', 'senate')),
  phase text not null default 'open' check (phase in ('open', 'closed')),
  majority_party text not null check (majority_party in ('democrat', 'republican', 'independent')),
  opens_at timestamptz not null default now(),
  closes_at timestamptz not null,
  closed_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- At most one open session per chamber.
create unique index if not exists leadership_sessions_one_open_per_chamber
  on public.leadership_sessions (chamber)
  where phase = 'open';

create index if not exists leadership_sessions_phase_idx
  on public.leadership_sessions (phase, closes_at);

create table if not exists public.leadership_session_candidates (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.leadership_sessions (id) on delete cascade,
  role text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (session_id, user_id)
);

alter table public.leadership_session_candidates
  drop constraint if exists leadership_session_candidates_role_valid;
alter table public.leadership_session_candidates
  add constraint leadership_session_candidates_role_valid check (
    role in (
      'speaker',
      'house_majority_leader', 'house_majority_whip',
      'house_minority_leader', 'house_minority_whip',
      'senate_majority_leader', 'senate_majority_whip',
      'senate_minority_leader', 'senate_minority_whip',
      'president_pro_tempore'
    )
  );

create index if not exists leadership_session_candidates_session_role_idx
  on public.leadership_session_candidates (session_id, role);

create table if not exists public.leadership_session_votes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.leadership_sessions (id) on delete cascade,
  role text not null,
  voter_id uuid not null references auth.users (id) on delete cascade,
  candidate_id uuid not null references public.leadership_session_candidates (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (session_id, role, voter_id)
);

create index if not exists leadership_session_votes_candidate_idx
  on public.leadership_session_votes (session_id, role, candidate_id);

-- ---------- RLS ----------
-- Read: any authenticated user (elections are public). Writes all go through server actions
-- (service role / security definer) so we don't need permissive policies for authenticated.

alter table public.leadership_sessions enable row level security;
alter table public.leadership_session_candidates enable row level security;
alter table public.leadership_session_votes enable row level security;

drop policy if exists "leadership_sessions read" on public.leadership_sessions;
create policy "leadership_sessions read" on public.leadership_sessions
  for select using (auth.role() = 'authenticated');

drop policy if exists "leadership_sessions insert admin" on public.leadership_sessions;
create policy "leadership_sessions insert admin" on public.leadership_sessions
  for insert with check (public.is_staff_admin(auth.uid()));

drop policy if exists "leadership_sessions update admin" on public.leadership_sessions;
create policy "leadership_sessions update admin" on public.leadership_sessions
  for update using (public.is_staff_admin(auth.uid()));

drop policy if exists "leadership_session_candidates read" on public.leadership_session_candidates;
create policy "leadership_session_candidates read" on public.leadership_session_candidates
  for select using (auth.role() = 'authenticated');

drop policy if exists "leadership_session_candidates insert self" on public.leadership_session_candidates;
create policy "leadership_session_candidates insert self" on public.leadership_session_candidates
  for insert with check (user_id = auth.uid());

drop policy if exists "leadership_session_candidates delete self" on public.leadership_session_candidates;
create policy "leadership_session_candidates delete self" on public.leadership_session_candidates
  for delete using (user_id = auth.uid());

drop policy if exists "leadership_session_votes read" on public.leadership_session_votes;
create policy "leadership_session_votes read" on public.leadership_session_votes
  for select using (auth.role() = 'authenticated');

drop policy if exists "leadership_session_votes insert self" on public.leadership_session_votes;
create policy "leadership_session_votes insert self" on public.leadership_session_votes
  for insert with check (voter_id = auth.uid());

drop policy if exists "leadership_session_votes update self" on public.leadership_session_votes;
create policy "leadership_session_votes update self" on public.leadership_session_votes
  for update using (voter_id = auth.uid());

drop policy if exists "leadership_session_votes delete self" on public.leadership_session_votes;
create policy "leadership_session_votes delete self" on public.leadership_session_votes
  for delete using (voter_id = auth.uid());

-- ---------- Close + role-transition function ----------

create or replace function public.close_leadership_session(s_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  sess record;
  rk text;  -- loop variable: can't be named role_key, collides with government_role_grants.role_key
  chamber_role text;
  winner_user uuid;
  best_votes integer;
  best_seniority timestamptz;
  cand record;
  cand_votes integer;
  cand_seniority timestamptz;
  roles text[];
begin
  select id, chamber, phase, majority_party
    into sess
    from public.leadership_sessions
    where id = s_id
    for update;
  if not found then
    return;
  end if;
  if sess.phase = 'closed' then
    return;
  end if;

  chamber_role := case when sess.chamber = 'house' then 'representative' else 'senator' end;

  if sess.chamber = 'house' then
    roles := array[
      'speaker',
      'house_majority_leader', 'house_majority_whip',
      'house_minority_leader', 'house_minority_whip'
    ];
  else
    roles := array[
      'president_pro_tempore',
      'senate_majority_leader', 'senate_majority_whip',
      'senate_minority_leader', 'senate_minority_whip'
    ];
  end if;

  foreach rk in array roles loop
    winner_user := null;
    best_votes := -1;
    best_seniority := null;

    for cand in
      select
        c.id,
        c.user_id,
        c.created_at as filed_at,
        (
          select count(*)::int
          from public.leadership_session_votes v
          where v.session_id = s_id
            and v.role = rk
            and v.candidate_id = c.id
        ) as votes,
        coalesce(
          (select g.granted_at
             from public.government_role_grants g
             where g.user_id = c.user_id and g.role_key = chamber_role
             order by g.granted_at asc
             limit 1),
          c.created_at
        ) as seniority_ts
      from public.leadership_session_candidates c
      where c.session_id = s_id and c.role = rk
    loop
      cand_votes := cand.votes;
      cand_seniority := cand.seniority_ts;
      if cand_votes > best_votes
         or (
           cand_votes = best_votes
           and (best_seniority is null or cand_seniority < best_seniority)
         )
      then
        best_votes := cand_votes;
        winner_user := cand.user_id;
        best_seniority := cand_seniority;
      end if;
    end loop;

    -- Clear any existing holder of THIS leadership role in this chamber, then grant to
    -- winner. If no candidates filed at all (winner_user is null) we still vacate the role
    -- so the directory reflects reality.
    delete from public.government_role_grants g
      where g.role_key = rk
        and (winner_user is null or g.user_id <> winner_user);

    if winner_user is not null then
      insert into public.government_role_grants (user_id, role_key)
        values (winner_user, rk)
        on conflict (user_id, role_key) do nothing;
    end if;
  end loop;

  update public.leadership_sessions
    set phase = 'closed',
        closed_at = now()
    where id = s_id;
end;
$$;

revoke all on function public.close_leadership_session(uuid) from public;
grant execute on function public.close_leadership_session(uuid) to authenticated;

-- ---------- Scheduler ----------
-- Called opportunistically from the web app (same pattern as
-- advance_election_phases_by_schedule). Closes any session whose window has elapsed.

create or replace function public.advance_leadership_sessions_by_schedule()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in
    select id
    from public.leadership_sessions
    where phase = 'open' and closes_at < now()
  loop
    perform public.close_leadership_session(r.id);
  end loop;
end;
$$;

revoke all on function public.advance_leadership_sessions_by_schedule() from public;
grant execute on function public.advance_leadership_sessions_by_schedule() to anon, authenticated;

comment on function public.advance_leadership_sessions_by_schedule() is
  'Auto-closes leadership sessions whose closes_at has passed. Safe to call on every request.';
