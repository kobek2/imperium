-- Biennial party leadership: idle → filing (14d) → voting (14d) → auto-install officers; chair/treasurer may fund races.

alter table public.party_organizations
  add column if not exists leadership_phase text not null default 'idle',
  add column if not exists leadership_filing_ends_at timestamptz,
  add column if not exists leadership_voting_ends_at timestamptz,
  add column if not exists last_leadership_cycle_completed_at timestamptz,
  add column if not exists next_leadership_election_opens_at timestamptz;

alter table public.party_organizations drop constraint if exists party_leadership_phase_chk;
alter table public.party_organizations
  add constraint party_leadership_phase_chk check (leadership_phase in ('idle', 'filing', 'voting'));

update public.party_organizations
set next_leadership_election_opens_at = coalesce(
    next_leadership_election_opens_at,
    coalesce(last_leadership_cycle_completed_at, now()) + interval '2 years'
  )
where party_key in ('democrat', 'republican');

create table if not exists public.party_treasury_election_grants (
  id uuid primary key default gen_random_uuid(),
  party_key text not null references public.party_organizations (party_key) on delete cascade,
  election_id uuid not null references public.elections (id) on delete cascade,
  amount numeric(20, 2) not null check (amount > 0),
  campaign_points_added integer not null check (campaign_points_added >= 0),
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index party_treasury_election_grants_party_idx on public.party_treasury_election_grants (party_key, created_at desc);

alter table public.party_treasury_election_grants enable row level security;

drop policy if exists "party_treasury_election_grants read authed" on public.party_treasury_election_grants;
create policy "party_treasury_election_grants read authed" on public.party_treasury_election_grants
  for select using (auth.role() = 'authenticated');

-- Advance leadership cycle (call from app on party page load). One transition per invocation.
create or replace function public.party_tick_leadership_cycle(p_party text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  org record;
  r record;
  winner uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_party not in ('democrat', 'republican') then raise exception 'Invalid party'; end if;

  select * into org from public.party_organizations where party_key = p_party for update;

  if org.leadership_phase = 'idle'
     and org.next_leadership_election_opens_at is not null
     and org.next_leadership_election_opens_at <= now() then
    update public.party_organizations
    set
      leadership_phase = 'filing',
      leadership_filing_ends_at = now() + interval '14 days',
      leadership_voting_ends_at = null,
      updated_at = now()
    where party_key = p_party;
    return jsonb_build_object('ok', true, 'event', 'filing_opened', 'filing_ends_at', (now() + interval '14 days'));
  end if;

  if org.leadership_phase = 'filing'
     and org.leadership_filing_ends_at is not null
     and org.leadership_filing_ends_at <= now() then
    update public.party_organizations
    set
      leadership_phase = 'voting',
      leadership_voting_ends_at = now() + interval '14 days',
      updated_at = now()
    where party_key = p_party;
    return jsonb_build_object('ok', true, 'event', 'voting_opened', 'voting_ends_at', (now() + interval '14 days'));
  end if;

  if org.leadership_phase = 'voting'
     and org.leadership_voting_ends_at is not null
     and org.leadership_voting_ends_at <= now() then
    for r in
      select * from unnest(array['chair', 'vice_chair', 'treasurer']::text[]) as x(office)
    loop
      winner := null;
      select v.candidate_id
      into winner
      from public.party_officer_votes v
      where v.party_key = p_party and v.office = r.office
      group by v.candidate_id
      order by count(*) desc, v.candidate_id asc
      limit 1;

      if winner is not null then
        insert into public.party_officers (party_key, office, user_id, since)
        values (p_party, r.office, winner, now())
        on conflict (party_key, office) do update
        set user_id = excluded.user_id, since = excluded.since;
      end if;

      delete from public.party_officer_votes where party_key = p_party and office = r.office;
      delete from public.party_officer_candidacies where party_key = p_party and office = r.office;
    end loop;

    update public.party_organizations
    set
      leadership_phase = 'idle',
      leadership_filing_ends_at = null,
      leadership_voting_ends_at = null,
      last_leadership_cycle_completed_at = now(),
      next_leadership_election_opens_at = now() + interval '2 years',
      updated_at = now()
    where party_key = p_party;

    return jsonb_build_object('ok', true, 'event', 'cycle_completed', 'next_opens_at', (now() + interval '2 years'));
  end if;

  return jsonb_build_object('ok', true, 'event', 'noop', 'phase', org.leadership_phase);
end;
$$;

grant execute on function public.party_tick_leadership_cycle(text) to authenticated;

create or replace function public.party_declare_candidacy(p_party text, p_office text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  prof_party text;
  ph text;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if p_party not in ('democrat', 'republican') or p_office not in ('chair', 'vice_chair', 'treasurer') then
    raise exception 'Invalid party or office';
  end if;

  select leadership_phase into ph from public.party_organizations where party_key = p_party;
  if ph is distinct from 'filing' then
    raise exception 'Leadership candidacy is only open during the party filing window (check back at the next biennial cycle).';
  end if;

  select party into prof_party from public.profiles where id = v_uid;
  if prof_party is distinct from p_party then raise exception 'Party mismatch'; end if;

  insert into public.party_officer_candidacies (party_key, office, user_id)
  values (p_party, p_office, v_uid)
  on conflict (party_key, office, user_id) do nothing;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.party_declare_candidacy(text, text) to authenticated;

create or replace function public.party_cast_officer_vote(p_party text, p_office text, p_candidate uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  prof_party text;
  ph text;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if p_party not in ('democrat', 'republican') or p_office not in ('chair', 'vice_chair', 'treasurer') then
    raise exception 'Invalid party or office';
  end if;

  select leadership_phase into ph from public.party_organizations where party_key = p_party;
  if ph is distinct from 'voting' then
    raise exception 'Leadership voting is not open right now.';
  end if;

  select party into prof_party from public.profiles where id = v_uid;
  if prof_party is distinct from p_party then raise exception 'Party mismatch'; end if;

  if not exists (
    select 1 from public.party_officer_candidacies c
    where c.party_key = p_party and c.office = p_office and c.user_id = p_candidate
  ) then
    raise exception 'Candidate is not running for this office';
  end if;

  insert into public.party_officer_votes (party_key, office, voter_id, candidate_id)
  values (p_party, p_office, v_uid, p_candidate)
  on conflict (party_key, office, voter_id) do update set candidate_id = excluded.candidate_id, voted_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.party_cast_officer_vote(text, text, uuid) to authenticated;

create or replace function public.party_deposit_treasury_to_election(p_party text, p_election_id uuid, p_amount numeric)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  a numeric := round(p_amount, 2);
  prof_party text;
  pts int;
  n int;
  po record;
  ephase text;
  total_pts int;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if p_party not in ('democrat', 'republican') then raise exception 'Invalid party'; end if;
  if a is null or a < 50000 or a > 500000000 then raise exception 'Amount must be at least $50,000 (one campaign point) and at most $500,000,000'; end if;

  if not exists (
    select 1 from public.party_officers po
    where po.party_key = p_party
      and po.office in ('chair', 'treasurer')
      and po.user_id = v_uid
  ) then
    raise exception 'Only the party chair or treasurer may direct treasury funds to a race';
  end if;

  select party into prof_party from public.profiles where id = v_uid;
  if prof_party is distinct from p_party then raise exception 'Party mismatch'; end if;

  select phase into ephase from public.elections where id = p_election_id;
  if ephase is null then raise exception 'Election not found'; end if;
  if ephase = 'closed' then raise exception 'That election is already closed'; end if;

  select count(*)::int into n
  from public.election_candidates ec
  where ec.election_id = p_election_id and ec.party::text = p_party;
  if n < 1 then raise exception 'No candidates from your party are filed in that election'; end if;

  pts := floor(a / 50000)::int;
  if pts < 1 then raise exception 'Amount too small to convert to campaign points'; end if;

  select * into po from public.party_organizations where party_key = p_party for update;
  if po.treasury_balance < a then raise exception 'Insufficient party treasury balance'; end if;

  update public.party_organizations
  set treasury_balance = treasury_balance - a, updated_at = now()
  where party_key = p_party;

  with cands as (
    select
      ec.id,
      row_number() over (order by ec.id) as rn,
      count(*) over ()::int as ncnt
    from public.election_candidates ec
    where ec.election_id = p_election_id and ec.party::text = p_party
  ),
  calc as (
    select
      cands.id,
      (pts / ncnt) + case when rn <= (pts % ncnt) then 1 else 0 end as add_pts
    from cands
  )
  update public.election_candidates ec
  set campaign_points_total = coalesce(ec.campaign_points_total, 0) + calc.add_pts
  from calc
  where ec.id = calc.id;

  total_pts := pts;

  insert into public.party_treasury_election_grants (party_key, election_id, amount, campaign_points_added, created_by)
  values (p_party, p_election_id, a, total_pts, v_uid);

  return jsonb_build_object(
    'ok', true,
    'amount', a,
    'campaign_points_added', total_pts,
    'treasury_after', (select treasury_balance from public.party_organizations where party_key = p_party)
  );
end;
$$;

grant execute on function public.party_deposit_treasury_to_election(text, uuid, numeric) to authenticated;

notify pgrst, 'reload schema';
