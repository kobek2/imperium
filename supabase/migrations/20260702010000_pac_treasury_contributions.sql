-- PAC treasury funding, candidate contributions, coordination, and campaign ad types.

-- ---------- Fund PAC treasury from wallet ----------
create or replace function public.pac_fund_treasury(p_amount numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  amt numeric := round(greatest(coalesce(p_amount, 0), 0), 2);
  w record;
  pac_row record;
  new_bal numeric;
  new_treasury numeric;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  perform public._economy_require_active_budget();
  if amt <= 0 then raise exception 'Amount must be positive'; end if;

  select * into pac_row from public.economy_pacs where user_id = v_uid for update;
  if pac_row.user_id is null then raise exception 'No PAC registered'; end if;

  insert into public.economy_wallets (user_id) values (v_uid) on conflict do nothing;
  select * into w from public.economy_wallets where user_id = v_uid for update;
  if w.balance < amt then raise exception 'Insufficient wallet balance'; end if;

  new_bal := w.balance - amt;
  new_treasury := pac_row.treasury_balance + amt;

  update public.economy_wallets set balance = new_bal, updated_at = now() where user_id = v_uid;
  update public.economy_pacs set treasury_balance = new_treasury, updated_at = now() where user_id = v_uid;

  insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
  values (v_uid, -amt, new_bal, 'pac_deposit', jsonb_build_object('treasury_after', new_treasury));

  return jsonb_build_object('ok', true, 'treasury_balance', new_treasury, 'wallet_balance', new_bal);
end;
$$;

grant execute on function public.pac_fund_treasury(numeric) to authenticated;

-- Back-compat
create or replace function public.pac_deposit_from_wallet(p_amount numeric)
returns jsonb language sql security definer set search_path = public as $$
  select public.pac_fund_treasury(p_amount);
$$;
grant execute on function public.pac_deposit_from_wallet(numeric) to authenticated;

-- ---------- Contribute to candidate (legal or dark) ----------
create or replace function public.pac_contribute_to_candidate(
  p_election uuid,
  p_candidate uuid,
  p_amount numeric,
  p_dark boolean default false
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
  pts_per numeric;
  new_treasury numeric;
  new_exposure numeric;
  target_uid uuid;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  perform public._economy_require_active_budget();
  if amt < 100000 then raise exception 'Minimum contribution is $100,000'; end if;

  select * into pac_row from public.economy_pacs where user_id = v_uid for update;
  if pac_row.user_id is null then raise exception 'No PAC registered'; end if;
  if pac_row.treasury_balance < amt then raise exception 'Insufficient PAC treasury'; end if;

  select ec.id, ec.user_id, ec.election_id, e.phase
  into cand
  from public.election_candidates ec
  join public.elections e on e.id = ec.election_id
  where ec.id = p_candidate and ec.election_id = p_election;
  if cand.id is null then raise exception 'Candidate not found'; end if;
  if cand.phase <> 'general' then raise exception 'Contributions only during general election'; end if;

  target_uid := cand.user_id;

  if not coalesce(p_dark, false) then
    select coalesce(sum(pc.amount), 0) into disclosed
    from public.pac_contributions pc
    where pc.pac_user_id = v_uid and pc.election_id = p_election and pc.candidate_id = p_candidate and pc.is_dark = false;
    if disclosed + amt > legal_cap then
      raise exception 'Legal cap exceeded ($% disclosed + $% = over $% limit)', disclosed, amt, legal_cap;
    end if;
    pts_per := 500000;
  else
    pts_per := 300000;
  end if;

  pts := floor(amt / pts_per);
  if pts < 1 then raise exception 'Amount too small for at least 1 campaign point'; end if;

  new_treasury := pac_row.treasury_balance - amt;
  update public.economy_pacs set treasury_balance = new_treasury, updated_at = now() where user_id = v_uid;

  update public.election_candidates
  set campaign_points_total = coalesce(campaign_points_total, 0) + pts
  where id = p_candidate;

  insert into public.pac_contributions (pac_user_id, election_id, candidate_id, amount, campaign_points, is_dark)
  values (v_uid, p_election, p_candidate, amt, pts, coalesce(p_dark, false));

  if coalesce(p_dark, false) then
    new_exposure := least(100, pac_row.exposure_risk + 15);
    update public.economy_pacs set exposure_risk = new_exposure where user_id = v_uid;
    insert into public.corruption_ledger (actor_user_id, target_user_id, action_type, amount, election_id, metadata)
    values (v_uid, target_uid, 'dark_money', amt, p_election, jsonb_build_object('candidate_id', p_candidate, 'points', pts));
  end if;

  insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
  select v_uid, 0, w.balance, 'pac_contribution',
    jsonb_build_object('election_id', p_election, 'candidate_id', p_candidate, 'amount', amt, 'points', pts, 'dark', coalesce(p_dark, false))
  from public.economy_wallets w where w.user_id = v_uid;

  return jsonb_build_object('ok', true, 'treasury_balance', new_treasury, 'campaign_points', pts, 'exposure_risk', coalesce(new_exposure, pac_row.exposure_risk));
end;
$$;

grant execute on function public.pac_contribute_to_candidate(uuid, uuid, numeric, boolean) to authenticated;

-- ---------- Coordination (illegal, once per candidate) ----------
create or replace function public.pac_coordinate_with_candidate(p_election uuid, p_candidate uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  cost numeric := 5000000;
  pac_row record;
  cand record;
  target_uid uuid;
  new_treasury numeric;
  new_exposure numeric;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  perform public._economy_require_active_budget();

  select * into pac_row from public.economy_pacs where user_id = v_uid for update;
  if pac_row.user_id is null then raise exception 'No PAC registered'; end if;
  if pac_row.treasury_balance < cost then raise exception 'Insufficient PAC treasury ($5,000,000 required)'; end if;

  select ec.id, ec.user_id, e.phase into cand
  from public.election_candidates ec join public.elections e on e.id = ec.election_id
  where ec.id = p_candidate and ec.election_id = p_election;
  if cand.id is null then raise exception 'Candidate not found'; end if;
  if cand.phase <> 'general' then raise exception 'Coordination only during general election'; end if;

  if exists (
    select 1 from public.pac_coordinations
    where pac_user_id = v_uid and election_id = p_election and candidate_id = p_candidate
  ) then
    raise exception 'Already coordinated with this candidate in this election';
  end if;

  target_uid := cand.user_id;
  new_treasury := pac_row.treasury_balance - cost;
  new_exposure := least(100, pac_row.exposure_risk + 25);

  update public.economy_pacs set treasury_balance = new_treasury, exposure_risk = new_exposure, updated_at = now() where user_id = v_uid;
  update public.election_candidates set campaign_points_total = coalesce(campaign_points_total, 0) + 20 where id = p_candidate;

  insert into public.pac_coordinations (pac_user_id, election_id, candidate_id) values (v_uid, p_election, p_candidate);
  insert into public.corruption_ledger (actor_user_id, target_user_id, action_type, amount, election_id, metadata)
  values (v_uid, target_uid, 'coordination', cost, p_election, jsonb_build_object('candidate_id', p_candidate, 'points', 20));

  return jsonb_build_object('ok', true, 'treasury_balance', new_treasury, 'campaign_points', 20, 'exposure_risk', new_exposure);
end;
$$;

grant execute on function public.pac_coordinate_with_candidate(uuid, uuid) to authenticated;

-- ---------- Remove PAC passive income from collect ----------
create or replace function public.economy_collect_income(p_body jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  w record;
  v_hours int;
  v_role_hourly numeric;
  v_gross numeric;
  v_salary_collect numeric;
  v_keys text[];
  v_party text;
  v_levy_rate numeric := 0;
  v_levy numeric := 0;
  v_after_levy numeric;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  perform public._economy_require_active_budget();

  insert into public.economy_wallets (user_id) values (v_uid) on conflict do nothing;
  select * into w from public.economy_wallets where user_id = v_uid for update;
  select public._economy_effective_role_keys(v_uid) into v_keys;
  v_role_hourly := public._economy_hourly_from_roles(v_keys);

  v_hours := floor(extract(epoch from (now() - w.last_collected_at)) / 3600)::int;
  v_hours := least(greatest(v_hours, 0), 24);

  if v_hours < 1 or v_role_hourly <= 0 then
    return jsonb_build_object('ok', true, 'hours', v_hours, 'paid', 0, 'balance', w.balance, 'role_hourly', v_role_hourly, 'pac_hourly', 0);
  end if;

  v_gross := v_role_hourly * v_hours;
  v_salary_collect := v_gross;

  select party into v_party from public.profiles where id = v_uid;
  if v_party in ('democrat', 'republican') then
    insert into public.party_organizations (party_key) values (v_party) on conflict (party_key) do nothing;
    begin
      select member_collect_levy_rate into strict v_levy_rate from public.party_organizations where party_key = v_party;
    exception when no_data_found then v_levy_rate := 0;
    end;
    v_levy := round(v_salary_collect * v_levy_rate, 2);
  end if;

  v_after_levy := v_salary_collect - v_levy;
  update public.economy_wallets
  set balance = balance + v_after_levy, last_collected_at = now(), updated_at = now()
  where user_id = v_uid;

  if v_levy > 0 then
    update public.party_organizations set treasury_balance = treasury_balance + v_levy, updated_at = now() where party_key = v_party;
    insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
    values (v_uid, -v_levy, w.balance + v_after_levy, 'party_levy', jsonb_build_object('party', v_party, 'rate', v_levy_rate));
  end if;

  insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
  values (v_uid, v_after_levy, w.balance + v_after_levy, 'income_collect', jsonb_build_object('hours', v_hours, 'role_hourly', v_role_hourly));

  return jsonb_build_object(
    'ok', true, 'hours', v_hours, 'paid', v_after_levy, 'balance', w.balance + v_after_levy,
    'party_levy', v_levy, 'role_hourly', v_role_hourly, 'pac_hourly', 0,
    'gross_collect', v_salary_collect, 'party_levy_salary_base', v_salary_collect
  );
end;
$$;

-- ---------- Campaign ad types ----------
alter table public.campaign_ads
  add column if not exists ad_type text not null default 'persuasion'
    check (ad_type in ('persuasion', 'attack', 'dark_money', 'suppression'));

alter table public.campaign_ads
  add column if not exists target_candidate_id uuid references public.election_candidates (id) on delete set null;

alter table public.campaign_ads
  add column if not exists cost numeric(20, 2);

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
      case when ad_kind = 'attack' then tgt.user_id else null end,
      case when ad_kind = 'suppression' then 'suppression_ad' else 'dark_money' end,
      cost,
      p_election,
      jsonb_build_object('candidate_id', p_candidate, 'target_candidate_id', p_target_candidate, 'ad_type', ad_kind)
    );
  elsif ad_kind = 'attack' then
    insert into public.corruption_ledger (actor_user_id, target_user_id, action_type, amount, election_id, metadata)
    values (v_uid, tgt.user_id, 'attack_ad', cost, p_election, jsonb_build_object('from_candidate', p_candidate, 'penalty', penalty));
  end if;

  insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
  values (v_uid, -cost, new_bal, 'campaign_ad', jsonb_build_object('ad_type', ad_kind, 'election_id', p_election, 'points', pts));

  return jsonb_build_object('ok', true, 'balance', new_bal, 'ad_type', ad_kind, 'points', pts, 'cost', cost);
end;
$$;

grant execute on function public.economy_use_campaign_ad(uuid, uuid, text, int, text, uuid) to authenticated;

-- Deprecate inventory-based ad purchase (wallet-direct only now)
create or replace function public.economy_buy_campaign_ads(p_qty int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'Campaign ads are purchased directly when you run them — select an ad type on the election page.';
end;
$$;
