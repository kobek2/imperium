-- Idempotent: creates campaign speech/rally/endorsement tables + RLS if missing (e.g. DB created before 20260419000000 or partial paste).

alter table public.states
  add column if not exists pvi numeric not null default 0;

create table if not exists public.campaign_speeches (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references public.elections (id) on delete cascade,
  candidate_id uuid not null references public.election_candidates (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  content text not null,
  word_count integer not null check (word_count >= 200),
  created_at timestamptz not null default now()
);

create table if not exists public.campaign_rallies (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references public.elections (id) on delete cascade,
  candidate_id uuid not null references public.election_candidates (id) on delete cascade,
  actor_id uuid not null references auth.users (id) on delete cascade,
  target_state char(2) references public.states(code),
  target_district text references public.districts(code),
  points numeric not null default 0.5 check (points >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.campaign_endorsements (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references public.elections (id) on delete cascade,
  candidate_id uuid not null references public.election_candidates (id) on delete cascade,
  endorser_user_id uuid not null references auth.users (id) on delete cascade,
  role_key text not null,
  points numeric not null default 0 check (points >= 0),
  created_at timestamptz not null default now(),
  unique (election_id, endorser_user_id)
);

alter table public.campaign_speeches enable row level security;
alter table public.campaign_rallies enable row level security;
alter table public.campaign_endorsements enable row level security;

drop policy if exists "campaign speeches read authed" on public.campaign_speeches;
drop policy if exists "campaign rallies read authed" on public.campaign_rallies;
drop policy if exists "campaign endorsements read authed" on public.campaign_endorsements;
drop policy if exists "campaign speeches insert self-candidate" on public.campaign_speeches;
drop policy if exists "campaign rallies insert self-candidate" on public.campaign_rallies;
drop policy if exists "campaign endorsements upsert self" on public.campaign_endorsements;
drop policy if exists "campaign endorsements update self" on public.campaign_endorsements;

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

-- Nudge PostgREST so the Data API sees new tables without a long wait (no-op if not applicable).
notify pgrst, 'reload schema';
