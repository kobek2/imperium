-- Campaign scoring updates:
-- 1. Add `points` column to campaign_speeches so the trigger can mirror campaign_rallies.points.
-- 2. Add optional `target_state` / `target_district` to campaign_speeches so presidential candidates can
--    attribute speeches to a specific state when we eventually wire per-state EC scoring.
-- 3. Triggers on campaign_speeches and campaign_rallies that keep election_candidates.campaign_points_total
--    in sync automatically. Admin overrides via setCandidateCampaignPoints still work because the trigger
--    only adds/subtracts deltas, but we also allow direct UPDATEs.
-- 4. Backfill campaign_points_total from any rows that already exist.
-- 5. Senate races now use states.pvi as partisan lean in _close_general_for_election (mirroring the server
--    action in web/src/app/actions/elections.ts).

alter table public.campaign_speeches
  add column if not exists points numeric not null default 5 check (points >= 0);

alter table public.campaign_speeches
  add column if not exists target_state char(2) references public.states(code),
  add column if not exists target_district text references public.districts(code);

create or replace function public._campaign_points_delta()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  delta numeric := 0;
  target_candidate uuid := null;
begin
  if tg_op = 'INSERT' then
    delta := coalesce(new.points, 0);
    target_candidate := new.candidate_id;
  elsif tg_op = 'DELETE' then
    delta := -1 * coalesce(old.points, 0);
    target_candidate := old.candidate_id;
  elsif tg_op = 'UPDATE' then
    delta := coalesce(new.points, 0) - coalesce(old.points, 0);
    target_candidate := new.candidate_id;
    if new.candidate_id is distinct from old.candidate_id then
      update public.election_candidates
        set campaign_points_total = greatest(0, campaign_points_total - coalesce(old.points, 0))
        where id = old.candidate_id;
      delta := coalesce(new.points, 0);
    end if;
  end if;

  if target_candidate is not null and delta <> 0 then
    update public.election_candidates
      set campaign_points_total = greatest(0, campaign_points_total + delta)
      where id = target_candidate;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists campaign_speeches_points_sync on public.campaign_speeches;
create trigger campaign_speeches_points_sync
after insert or update or delete on public.campaign_speeches
for each row execute function public._campaign_points_delta();

drop trigger if exists campaign_rallies_points_sync on public.campaign_rallies;
create trigger campaign_rallies_points_sync
after insert or update or delete on public.campaign_rallies
for each row execute function public._campaign_points_delta();

-- Backfill: we may have rows whose points haven't been reflected yet. Recompute from scratch.
update public.election_candidates ec
set campaign_points_total = coalesce(t.total, 0)
from (
  select candidate_id, sum(points) as total from (
    select candidate_id, points from public.campaign_speeches
    union all
    select candidate_id, points from public.campaign_rallies
  ) unioned
  group by candidate_id
) t
where ec.id = t.candidate_id;

-- Senate now uses states.pvi the same way house uses districts.pvi.
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
  select e.office, e.district_code, e.state
    into race
    from public.elections e
    where e.id = e_election;
  if not found then return; end if;
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
