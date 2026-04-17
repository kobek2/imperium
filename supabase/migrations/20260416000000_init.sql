-- PolSim Command Center — core schema
-- Run with Supabase CLI or paste into SQL editor.

create extension if not exists "pgcrypto";

-- ---------- Regions (presidential 40% community vote) ----------
create type public.us_region as enum ('northeast_midwest', 'south', 'west');

create table public.states (
  code char(2) primary key,
  name text not null,
  region public.us_region not null,
  senate_class smallint check (senate_class between 1 and 3)
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
  primary_party_wide boolean not null default true,
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
  ('DC', 'District of Columbia', 'south', null),
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
alter table public.campaign_speeches enable row level security;
alter table public.campaign_rallies enable row level security;
alter table public.campaign_endorsements enable row level security;
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

create policy "campaign speeches read authed" on public.campaign_speeches
for select using (auth.role() = 'authenticated');

create policy "campaign rallies read authed" on public.campaign_rallies
for select using (auth.role() = 'authenticated');

create policy "campaign endorsements read authed" on public.campaign_endorsements
for select using (auth.role() = 'authenticated');

create policy "campaign speeches insert self-candidate" on public.campaign_speeches
for insert with check (
  auth.uid() = author_id
  and exists (
    select 1 from public.election_candidates c
    where c.id = candidate_id and c.user_id = auth.uid() and c.election_id = campaign_speeches.election_id
  )
);

create policy "campaign rallies insert self-candidate" on public.campaign_rallies
for insert with check (
  auth.uid() = actor_id
  and exists (
    select 1 from public.election_candidates c
    where c.id = candidate_id and c.user_id = auth.uid() and c.election_id = campaign_rallies.election_id
  )
);

create policy "campaign endorsements upsert self" on public.campaign_endorsements
for insert with check (auth.uid() = endorser_user_id);

create policy "campaign endorsements update self" on public.campaign_endorsements
for update using (auth.uid() = endorser_user_id);

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
as $
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  uname text;
begin
  uname := nullif(trim(coalesce(
    meta->>'preferred_username',
    meta->>'user_name',
    meta->>'global_name',
    meta->>'full_name',
    meta->>'name',
    meta->>'nickname',
    meta->>'username',
    ''
  )), '');

  insert into public.profiles (id, discord_user_id, discord_username, character_name, party)
  values (
    new.id,
    coalesce(
      nullif(meta->>'provider_id', ''),
      nullif(meta->>'sub', ''),
      new.id::text
    ),
    uname,
    coalesce(meta->>'full_name', meta->>'name', split_part(new.email, '@', 1), 'Citizen'),
    'independent'
  )
  on conflict (id) do nothing;
  return new;
end;
$;

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
