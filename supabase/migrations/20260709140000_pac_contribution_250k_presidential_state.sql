-- PAC contributions: $250K per campaign point (floor), $10M cap per PAC donor per candidate.
-- Presidential races require target_state; House/Senate add to campaign_points_total.

alter table public.pac_contributions
  add column if not exists target_state char(2) references public.states (code);

create index if not exists pac_contributions_pac_candidate_idx
  on public.pac_contributions (pac_user_id, election_id, candidate_id)
  where is_dark = false;

drop function if exists public.pac_contribute_to_candidate(uuid, uuid, numeric, boolean);

create or replace function public.pac_contribute_to_candidate(
  p_election uuid,
  p_candidate uuid,
  p_amount numeric,
  p_dark boolean default false,
  p_target_state text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  amt numeric := round(greatest(coalesce(p_amount, 0), 0), 2);
  pac_row record;
  cand record;
  legal_cap numeric := 10000000;
  disclosed numeric := 0;
  pts numeric;
  pts_per numeric := 250000;
  new_treasury numeric;
  new_exposure numeric;
  target_uid uuid;
  v_state char(2);
  norm_state text := nullif(upper(trim(coalesce(p_target_state, ''))), '');
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  perform public._economy_require_active_budget();
  if amt < 100000 then raise exception 'Minimum contribution is $100,000'; end if;

  select * into pac_row from public.economy_pacs where user_id = v_uid for update;
  if pac_row.user_id is null then raise exception 'No PAC registered'; end if;
  if pac_row.treasury_balance < amt then raise exception 'Insufficient PAC treasury'; end if;

  select ec.id, ec.user_id, ec.election_id, ec.primary_winner, e.phase, e.office, e.leadership_role, e.general_closes_at
  into cand
  from public.election_candidates ec
  join public.elections e on e.id = ec.election_id
  where ec.id = p_candidate and ec.election_id = p_election;
  if cand.id is null then raise exception 'Candidate not found'; end if;
  if cand.phase <> 'general' then raise exception 'Contributions only during general election'; end if;
  if cand.leadership_role is not null then raise exception 'PAC contributions do not apply to leadership races'; end if;
  if cand.general_closes_at <= now() then raise exception 'General election is closed'; end if;
  if cand.user_id = v_uid then raise exception 'You cannot contribute to your own candidacy'; end if;

  if exists (
    select 1 from public.election_candidates x
    where x.election_id = p_election and x.primary_winner is true
  ) and coalesce(cand.primary_winner, false) is not true then
    raise exception 'Candidate is not a general-election nominee';
  end if;

  if cand.office = 'president' then
    if norm_state is null or length(norm_state) <> 2 then
      raise exception 'Presidential PAC spending requires a target state';
    end if;
    if not exists (select 1 from public.states s where s.code = norm_state) then
      raise exception 'Invalid state code';
    end if;
    v_state := norm_state::char(2);
  elsif norm_state is not null then
    raise exception 'State targeting applies only to presidential races';
  end if;

  target_uid := cand.user_id;

  if not coalesce(p_dark, false) then
    select coalesce(sum(pc.amount), 0) into disclosed
    from public.pac_contributions pc
    where pc.pac_user_id = v_uid
      and pc.election_id = p_election
      and pc.candidate_id = p_candidate
      and pc.is_dark = false;
    if disclosed + amt > legal_cap then
      raise exception 'Legal cap exceeded — this candidate can receive at most $10,000,000 total from your PAC (already $% disclosed)', disclosed;
    end if;
  else
    pts_per := 250000;
  end if;

  pts := floor(amt / pts_per);
  if pts < 1 then raise exception 'Amount too small — need at least $250,000 for 1 campaign point'; end if;

  new_treasury := pac_row.treasury_balance - amt;
  update public.economy_pacs set treasury_balance = new_treasury, updated_at = now() where user_id = v_uid;

  if cand.office <> 'president' then
    update public.election_candidates
    set campaign_points_total = coalesce(campaign_points_total, 0) + pts
    where id = p_candidate;
  end if;

  insert into public.pac_contributions (
    pac_user_id, election_id, candidate_id, amount, campaign_points, is_dark, target_state
  )
  values (
    v_uid, p_election, p_candidate, amt, pts, coalesce(p_dark, false), v_state
  );

  if coalesce(p_dark, false) then
    new_exposure := least(100, pac_row.exposure_risk + 15);
    update public.economy_pacs set exposure_risk = new_exposure where user_id = v_uid;
    insert into public.corruption_ledger (actor_user_id, target_user_id, action_type, amount, election_id, metadata)
    values (
      v_uid, target_uid, 'dark_money', amt, p_election,
      jsonb_build_object('candidate_id', p_candidate, 'points', pts, 'target_state', v_state)
    );
  end if;

  insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
  select v_uid, 0, w.balance, 'pac_contribution',
    jsonb_build_object(
      'election_id', p_election,
      'candidate_id', p_candidate,
      'amount', amt,
      'points', pts,
      'dark', coalesce(p_dark, false),
      'target_state', v_state,
      'office', cand.office
    )
  from public.economy_wallets w where w.user_id = v_uid;

  return jsonb_build_object(
    'ok', true,
    'treasury_balance', new_treasury,
    'campaign_points', pts,
    'exposure_risk', coalesce(new_exposure, pac_row.exposure_risk),
    'target_state', v_state,
    'disclosed_total', disclosed + case when coalesce(p_dark, false) then 0 else amt end,
    'disclosed_remaining', greatest(0, legal_cap - (disclosed + case when coalesce(p_dark, false) then 0 else amt end))
  );
end;
$$;

grant execute on function public.pac_contribute_to_candidate(uuid, uuid, numeric, boolean, text) to authenticated;

notify pgrst, 'reload schema';
