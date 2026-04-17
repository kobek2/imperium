-- Automatic election phase transitions driven by timestamps:
--   filing -> primary when filing_closes_at has passed
--   primary -> general when primary_closes_at has passed (same per-party winner rules as app "End primary")
-- Invoked from the web app via RPC advance_election_phases_by_schedule() (SECURITY DEFINER; not direct table writes by clients).

create or replace function public._close_primary_for_election(e_election uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p text;
  cand record;
  n bigint;
  best bigint;
  best_id uuid;
begin
  for p in select distinct ec.party from public.election_candidates ec where ec.election_id = e_election
  loop
    best := -1;
    best_id := null;
    for cand in
      select ec.id
      from public.election_candidates ec
      where ec.election_id = e_election and ec.party = p
      order by ec.id
    loop
      select count(*)::bigint into n
      from public.primary_votes pv
      where pv.election_id = e_election and pv.candidate_id = cand.id;

      if n > best then
        best := n;
        best_id := cand.id;
      end if;
    end loop;

    if best <= 0 or best_id is null then
      select ec.id into best_id
      from public.election_candidates ec
      where ec.election_id = e_election and ec.party = p
      order by ec.id
      limit 1;
    end if;

    update public.election_candidates ec
    set primary_winner = (ec.id = best_id)
    where ec.election_id = e_election and ec.party = p;
  end loop;

  update public.elections e
  set phase = 'general'::public.election_phase
  where e.id = e_election;
end;
$$;

create or replace function public.advance_election_phases_by_schedule()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  update public.elections
  set phase = 'primary'::public.election_phase
  where phase = 'filing'::public.election_phase
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
end;
$$;

revoke all on function public._close_primary_for_election(uuid) FROM PUBLIC;
revoke all on function public.advance_election_phases_by_schedule() FROM PUBLIC;
grant execute on function public.advance_election_phases_by_schedule() to anon, authenticated;

comment on function public.advance_election_phases_by_schedule() is
  'Moves races along by schedule: filing->primary after filing_closes_at; primary->general after primary_closes_at with per-party plurality from primary_votes (ties: lexicographically smallest candidate id).';
