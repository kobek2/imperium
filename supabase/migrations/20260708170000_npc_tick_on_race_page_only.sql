-- NPC campaign ticks should not run on every site page load (felt reactive after player speeches).
-- Ticks run when someone opens an election race page instead.

create or replace function public._election_has_recent_player_campaign(p_election_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.campaign_speeches s
    join public.election_candidates c on c.id = s.candidate_id
    where c.election_id = p_election_id
      and coalesce(c.is_npc, false) = false
      and s.created_at > now() - interval '15 minutes'
  )
  or exists (
    select 1
    from public.campaign_ads a
    join public.election_candidates c on c.id = a.candidate_id
    where c.election_id = p_election_id
      and coalesce(c.is_npc, false) = false
      and a.created_at > now() - interval '15 minutes'
  )
  or exists (
    select 1
    from public.campaign_rallies r
    join public.election_candidates c on c.id = r.candidate_id
    where c.election_id = p_election_id
      and coalesce(c.is_npc, false) = false
      and r.created_at > now() - interval '15 minutes'
  );
$$;

create or replace function public.tick_npc_campaigns(p_election_id uuid default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  npc_id uuid;
  race_id uuid;
  n int := 0;
begin
  for npc_id, race_id in
    select ec.id, ec.election_id
    from public.election_candidates ec
    join public.elections e on e.id = ec.election_id
    where coalesce(ec.is_npc, false) = true
      and e.phase = 'general'
      and (e.general_closes_at is null or now() <= e.general_closes_at)
      and (p_election_id is null or e.id = p_election_id)
  loop
    if public._election_has_recent_player_campaign(race_id) then
      continue;
    end if;
    if public._npc_deliver_scheduled_speech(npc_id) then
      n := n + 1;
    end if;
    if public._npc_deliver_scheduled_ad(npc_id) then
      n := n + 1;
    end if;
  end loop;
  return n;
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
    and leadership_role is null
    and filing_window_started_at is not null
    and filing_closes_at is not null
    and filing_closes_at < now();

  update public.elections
  set phase = 'general'::public.election_phase
  where phase = 'filing'::public.election_phase
    and leadership_role is not null
    and filing_window_started_at is not null
    and filing_closes_at is not null
    and filing_closes_at < now();

  for r in
    select e.id
    from public.elections e
    where e.phase = 'primary'::public.election_phase
      and e.filing_window_started_at is not null
      and e.primary_closes_at is not null
      and e.primary_closes_at < now()
  loop
    begin
      perform public._close_primary_for_election(r.id);
    exception
      when others then
        raise warning 'advance_election_phases: primary close failed for %: %', r.id, sqlerrm;
    end;
  end loop;

  for r in
    select e.id
    from public.elections e
    where e.phase = 'general'::public.election_phase
      and e.filing_window_started_at is not null
      and e.general_closes_at is not null
      and e.general_closes_at < now()
  loop
    begin
      perform public.tick_npc_campaigns(r.id);
      perform public._close_general_for_election(r.id);
    exception
      when others then
        raise warning 'advance_election_phases: general close failed for %: %', r.id, sqlerrm;
    end;
  end loop;
end;
$$;

-- Reset ad timers so the next persuasion ad is genuinely 3h away (not due on next page view).
update public.election_candidates
set npc_last_ad_at = now()
where coalesce(is_npc, false) = true;

notify pgrst, 'reload schema';
