-- party_finalize_officer_election: use is_staff_admin (same as other staff RPCs).
-- When the last office is finalized and no votes/candidacies remain, close the open leadership window (idle + next RP).

create or replace function public.party_finalize_officer_election(p_party text, p_office text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  winner uuid;
  vote_count bigint;
  rp_today date;
  next_rp date;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if p_party not in ('democrat', 'republican') or p_office not in ('chair', 'vice_chair', 'treasurer') then
    raise exception 'Invalid party or office';
  end if;

  if not public.is_staff_admin(v_uid) then
    raise exception 'Admin only';
  end if;

  select v.candidate_id, count(*)::bigint
  into winner, vote_count
  from public.party_officer_votes v
  where v.party_key = p_party and v.office = p_office
  group by v.candidate_id
  order by count(*) desc, v.candidate_id asc
  limit 1;

  if winner is null then
    return jsonb_build_object('ok', false, 'reason', 'no_votes');
  end if;

  insert into public.party_officers (party_key, office, user_id, since)
  values (p_party, p_office, winner, now())
  on conflict (party_key, office) do update
  set user_id = excluded.user_id, since = excluded.since;

  delete from public.party_officer_votes where party_key = p_party and office = p_office;
  delete from public.party_officer_candidacies where party_key = p_party and office = p_office;

  -- Admin may finalize each office early; when nothing is left for this party, end the open election.
  if exists (
    select 1
    from public.party_organizations o
    where o.party_key = p_party
      and o.leadership_phase = 'open'
      and not exists (select 1 from public.party_officer_votes v where v.party_key = p_party)
      and not exists (select 1 from public.party_officer_candidacies c where c.party_key = p_party)
  ) then
    rp_today := public.simulation_rp_calendar_date();
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
  end if;

  return jsonb_build_object('ok', true, 'winner', winner, 'votes', vote_count);
end;
$$;

grant execute on function public.party_finalize_officer_election(text, text) to authenticated;

notify pgrst, 'reload schema';
