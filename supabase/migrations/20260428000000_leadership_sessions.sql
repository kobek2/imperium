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
