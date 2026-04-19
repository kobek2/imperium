-- Party leadership: single 24h "open" window (declare, withdraw, vote/unvote). Auto-installs winners when time elapses.

-- Drop the old phase check *before* migrating rows to `open`, or the UPDATE violates
-- party_leadership_phase_chk while it still only allows idle/filing/voting.
alter table public.party_organizations drop constraint if exists party_leadership_phase_chk;

-- Migrate legacy filing / voting rows into one open election.
update public.party_organizations
set
  leadership_phase = 'open',
  leadership_filing_ends_at = case
    when leadership_phase = 'voting' and leadership_voting_ends_at is not null then leadership_voting_ends_at
    when leadership_phase = 'filing' and leadership_filing_ends_at is not null then leadership_filing_ends_at
    else coalesce(leadership_voting_ends_at, leadership_filing_ends_at, now() + interval '24 hours')
  end,
  leadership_voting_ends_at = null
where leadership_phase in ('filing', 'voting');

alter table public.party_organizations
  add constraint party_leadership_phase_chk check (leadership_phase in ('idle', 'open'));

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
  rp_today date;
  next_rp date;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_party not in ('democrat', 'republican') then raise exception 'Invalid party'; end if;

  rp_today := public.simulation_rp_calendar_date();

  select * into org from public.party_organizations where party_key = p_party for update;

  if org.leadership_phase = 'idle'
     and org.next_leadership_election_opens_on_rp is not null
     and rp_today >= org.next_leadership_election_opens_on_rp then
    update public.party_organizations
    set
      leadership_phase = 'open',
      leadership_filing_ends_at = now() + interval '24 hours',
      leadership_voting_ends_at = null,
      updated_at = now()
    where party_key = p_party;
    return jsonb_build_object('ok', true, 'event', 'election_opened', 'ends_at', (now() + interval '24 hours'));
  end if;

  if org.leadership_phase = 'open'
     and org.leadership_filing_ends_at is not null
     and org.leadership_filing_ends_at <= now() then
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

    next_rp := rp_today + interval '2 years';

    update public.party_organizations
    set
      leadership_phase = 'idle',
      leadership_filing_ends_at = null,
      leadership_voting_ends_at = null,
      last_leadership_cycle_completed_at = now(),
      next_leadership_election_opens_on_rp = next_rp,
      next_leadership_election_opens_at = null,
      updated_at = now()
    where party_key = p_party;

    return jsonb_build_object('ok', true, 'event', 'cycle_completed', 'next_opens_on_rp', next_rp);
  end if;

  return jsonb_build_object('ok', true, 'event', 'noop', 'phase', org.leadership_phase);
end;
$$;

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
  if ph is distinct from 'open' then
    raise exception 'Leadership candidacy is only open during the active 24-hour leadership election.';
  end if;

  select party into prof_party from public.profiles where id = v_uid;
  if prof_party is distinct from p_party then raise exception 'Party mismatch'; end if;

  insert into public.party_officer_candidacies (party_key, office, user_id)
  values (p_party, p_office, v_uid)
  on conflict (party_key, office, user_id) do nothing;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.party_withdraw_officer_candidacy(p_party text, p_office text)
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
  if ph is distinct from 'open' then
    raise exception 'You can only withdraw during the active leadership election.';
  end if;

  select party into prof_party from public.profiles where id = v_uid;
  if prof_party is distinct from p_party then raise exception 'Party mismatch'; end if;

  delete from public.party_officer_votes
  where party_key = p_party and office = p_office and candidate_id = v_uid;

  delete from public.party_officer_candidacies
  where party_key = p_party and office = p_office and user_id = v_uid;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.party_withdraw_officer_candidacy(text, text) to authenticated;

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
  cur uuid;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if p_party not in ('democrat', 'republican') or p_office not in ('chair', 'vice_chair', 'treasurer') then
    raise exception 'Invalid party or office';
  end if;

  select party into prof_party from public.profiles where id = v_uid;
  if prof_party is distinct from p_party then raise exception 'Party mismatch'; end if;

  select candidate_id into cur
  from public.party_officer_votes
  where party_key = p_party and office = p_office and voter_id = v_uid;

  -- Unvote always allowed (parity with primaries): clear ballot even if the window just closed.
  if cur is not distinct from p_candidate then
    delete from public.party_officer_votes
    where party_key = p_party and office = p_office and voter_id = v_uid;
    return jsonb_build_object('ok', true, 'event', 'unvoted');
  end if;

  select leadership_phase into ph from public.party_organizations where party_key = p_party;
  if ph is distinct from 'open' then
    raise exception 'Leadership voting is not open right now.';
  end if;

  if not exists (
    select 1 from public.party_officer_candidacies c
    where c.party_key = p_party and c.office = p_office and c.user_id = p_candidate
  ) then
    raise exception 'Candidate is not running for this office';
  end if;

  insert into public.party_officer_votes (party_key, office, voter_id, candidate_id)
  values (p_party, p_office, v_uid, p_candidate)
  on conflict (party_key, office, voter_id) do update set candidate_id = excluded.candidate_id, voted_at = now();

  return jsonb_build_object('ok', true, 'event', 'voted');
end;
$$;

create or replace function public.party_admin_start_party_leadership_filing(p_party text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  org record;
begin
  if auth.uid() is null or not public.is_staff_admin(auth.uid()) then
    raise exception 'Admin only';
  end if;
  if p_party not in ('democrat', 'republican') then
    raise exception 'Invalid party';
  end if;

  select * into org from public.party_organizations where party_key = p_party for update;
  if not found then
    raise exception 'Party organization not found';
  end if;

  if org.leadership_phase = 'open' then
    return jsonb_build_object('ok', true, 'event', 'already_open', 'election_ends_at', org.leadership_filing_ends_at);
  end if;

  if org.leadership_phase is distinct from 'idle' then
    raise exception 'Party leadership must be idle before starting a new election.';
  end if;

  delete from public.party_officer_candidacies where party_key = p_party;
  delete from public.party_officer_votes where party_key = p_party;

  update public.party_organizations
  set
    leadership_phase = 'open',
    leadership_filing_ends_at = now() + interval '24 hours',
    leadership_voting_ends_at = null,
    updated_at = now()
  where party_key = p_party;

  return jsonb_build_object(
    'ok', true,
    'event', 'election_opened_admin',
    'election_ends_at', (now() + interval '24 hours')
  );
end;
$$;

notify pgrst, 'reload schema';
