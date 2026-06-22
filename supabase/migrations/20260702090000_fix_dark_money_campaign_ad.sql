-- Fix dark_money / suppression ads: PL/pgSQL must not reference unassigned record "tgt".

create or replace function public.economy_use_campaign_ad(
  p_election uuid,
  p_candidate uuid,
  p_target_state text default null,
  p_qty int default 1,
  p_ad_type text default 'persuasion',
  p_target_candidate uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  cand record;
  tgt record;
  tgt_user_id uuid := null;
  use_state char(2);
  use_district text;
  w record;
  new_bal numeric;
  ad_kind text := lower(trim(coalesce(p_ad_type, 'persuasion')));
  cost numeric;
  pts numeric := 0;
  penalty numeric := 0;
  pac_row record;
  new_exposure numeric;
  exposure_add numeric := 0;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  perform public._economy_require_active_budget();

  cost := case ad_kind
    when 'persuasion' then 1000000
    when 'attack' then 1500000
    when 'dark_money' then 2000000
    when 'suppression' then 3000000
    else null
  end;
  if cost is null then raise exception 'Invalid ad type'; end if;

  pts := case ad_kind
    when 'persuasion' then 3
    when 'dark_money' then 5
    else 0
  end;
  penalty := case ad_kind when 'attack' then 4 else 0 end;
  exposure_add := case ad_kind when 'dark_money' then 10 when 'suppression' then 20 else 0 end;

  select ec.id, ec.user_id, ec.running_mate_user_id, ec.election_id, ec.campaign_points_total,
    e.office, e.phase, e.general_closes_at, e.state, e.district_code
  into cand
  from public.election_candidates ec join public.elections e on e.id = ec.election_id
  where ec.id = p_candidate and ec.election_id = p_election;
  if cand.id is null then raise exception 'Candidate not found'; end if;
  if cand.phase <> 'general' then raise exception 'Campaign ads only during general election'; end if;
  if cand.general_closes_at is not null and now() > cand.general_closes_at then raise exception 'General election closed'; end if;

  if cand.office = 'president' then
    if cand.user_id <> v_uid and cand.running_mate_user_id <> v_uid then
      raise exception 'Ads are for your own ticket only';
    end if;
    use_state := null; use_district := null;
  else
    if cand.user_id <> v_uid then raise exception 'Ads are for your own candidacy only'; end if;
    use_state := cand.state; use_district := cand.district_code;
  end if;

  if ad_kind = 'attack' then
    if p_target_candidate is null then raise exception 'Attack ads require a target candidate'; end if;
    select ec.id, ec.user_id, ec.campaign_points_total into tgt
    from public.election_candidates ec where ec.id = p_target_candidate and ec.election_id = p_election;
    if tgt.id is null then raise exception 'Target candidate not found'; end if;
    if tgt.id = p_candidate then raise exception 'Cannot attack yourself'; end if;
    tgt_user_id := tgt.user_id;
  end if;

  insert into public.economy_wallets (user_id) values (v_uid) on conflict do nothing;
  select * into w from public.economy_wallets where user_id = v_uid for update;
  if w.balance < cost then raise exception 'Insufficient balance ($% required)', cost; end if;

  new_bal := w.balance - cost;
  update public.economy_wallets set balance = new_bal, updated_at = now() where user_id = v_uid;

  if pts > 0 then
    update public.election_candidates set campaign_points_total = coalesce(campaign_points_total, 0) + pts where id = p_candidate;
  end if;
  if penalty > 0 and p_target_candidate is not null then
    update public.election_candidates
    set campaign_points_total = greatest(0, coalesce(campaign_points_total, 0) - penalty)
    where id = p_target_candidate;
  end if;

  insert into public.campaign_ads (election_id, candidate_id, actor_id, target_state, target_district, points, ad_type, target_candidate_id, cost)
  values (p_election, p_candidate, v_uid, use_state, use_district, greatest(pts, 1), ad_kind, p_target_candidate, cost);

  if exposure_add > 0 then
    select * into pac_row from public.economy_pacs where user_id = v_uid for update;
    if pac_row.user_id is not null then
      new_exposure := least(100, pac_row.exposure_risk + exposure_add);
      update public.economy_pacs set exposure_risk = new_exposure where user_id = v_uid;
    end if;
    insert into public.corruption_ledger (actor_user_id, target_user_id, action_type, amount, election_id, metadata)
    values (
      v_uid,
      null,
      case when ad_kind = 'suppression' then 'suppression_ad' else 'dark_money' end,
      cost,
      p_election,
      jsonb_build_object('candidate_id', p_candidate, 'target_candidate_id', p_target_candidate, 'ad_type', ad_kind)
    );
  elsif ad_kind = 'attack' then
    insert into public.corruption_ledger (actor_user_id, target_user_id, action_type, amount, election_id, metadata)
    values (v_uid, tgt_user_id, 'attack_ad', cost, p_election, jsonb_build_object('from_candidate', p_candidate, 'penalty', penalty));
  end if;

  insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
  values (v_uid, -cost, new_bal, 'campaign_ad', jsonb_build_object('ad_type', ad_kind, 'election_id', p_election, 'points', pts));

  return jsonb_build_object('ok', true, 'balance', new_bal, 'ad_type', ad_kind, 'points', pts, 'cost', cost);
end;
$$;
