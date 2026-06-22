-- Corruption expansion: bill-sector stock shocks, exposure-weighted investigations,
-- election rigging, vote bribery, contracts, deals, maintenance cron, expanded ledger types.

-- ---------- Expand ledger action types ----------
alter table public.corruption_ledger drop constraint if exists corruption_ledger_action_type_check;
alter table public.corruption_ledger add constraint corruption_ledger_action_type_check check (
  action_type in (
    'dark_money', 'coordination', 'stock_vote_conflict', 'insider_trade', 'suppression_ad', 'attack_ad',
    'vote_bribe', 'election_rig', 'voter_intimidation', 'fake_endorsement', 'party_treasury_divert',
    'government_contract', 'pump_and_dump', 'short_insider', 'foreign_money', 'super_pac_launder',
    'backroom_deal', 'whistleblower_leak', 'fixer_payment', 'immunity_deal', 'opposition_research',
    'ballot_harvesting', 'in_kind_coordination', 'committee_bribe', 'fec_audit', 'lobby_payment'
  )
);

-- ---------- Backroom deals ----------
create table if not exists public.corruption_deals (
  id uuid primary key default gen_random_uuid(),
  proposer_user_id uuid not null references public.profiles (id) on delete cascade,
  counterparty_user_id uuid not null references public.profiles (id) on delete cascade,
  deal_kind text not null default 'vote_trade',
  amount numeric(20, 2) not null check (amount > 0),
  bill_id uuid references public.bills (id) on delete set null,
  election_id uuid references public.elections (id) on delete set null,
  terms text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'broken')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists corruption_deals_counterparty_idx
  on public.corruption_deals (counterparty_user_id, status, created_at desc);

alter table public.corruption_deals enable row level security;
drop policy if exists "corruption_deals parties read" on public.corruption_deals;
create policy "corruption_deals parties read"
  on public.corruption_deals for select to authenticated
  using (proposer_user_id = auth.uid() or counterparty_user_id = auth.uid());

-- ---------- Helpers ----------
create or replace function public._bump_exposure_risk(p_uid uuid, p_add numeric)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  new_risk numeric;
begin
  if p_uid is null or coalesce(p_add, 0) <= 0 then
    return coalesce((select exposure_risk from public.economy_pacs where user_id = p_uid), 0);
  end if;
  update public.economy_pacs
  set exposure_risk = least(100, exposure_risk + p_add), updated_at = now()
  where user_id = p_uid
  returning exposure_risk into new_risk;
  return coalesce(new_risk, 0);
end;
$$;

create or replace function public._corruption_wire_story(
  p_template text,
  p_title text,
  p_summary text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.simulation_event_instances (template_key, title, summary, status, severity, metadata)
  values (p_template, p_title, p_summary, 'active', 2, coalesce(p_metadata, '{}'::jsonb));
exception when others then
  null;
end;
$$;

-- Sector stocks move when a tagged bill becomes law.
create or replace function public._corruption_on_bill_enacted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  biz record;
  bump numeric;
  new_price numeric;
begin
  if new.status is distinct from 'law'::public.bill_status then
    return new;
  end if;
  if old.status = 'law'::public.bill_status then
    return new;
  end if;
  if new.sector_tag is null then
    return new;
  end if;

  bump := case
    when lower(coalesce(new.policy_tags ->> 'stance_key', new.policy_tags ->> 'policy_value', '1'))
      in ('oppose', '-1', '0') then -0.06
    else 0.08
  end;

  for biz in
    select b.id, b.price_per_share, b.market_premium
    from public.businesses b
    where b.sector = new.sector_tag
  loop
    update public.businesses
    set market_premium = greatest(0.25, least(4.0, coalesce(biz.market_premium, 1) * (1 + bump)))
    where id = biz.id;
    new_price := public._business_refresh_share_price(biz.id);
    insert into public.business_price_history (business_id, price_per_share)
    values (biz.id, new_price);
  end loop;

  return new;
end;
$$;

drop trigger if exists corruption_bill_sector_stock on public.bills;
create trigger corruption_bill_sector_stock
  after update of status on public.bills
  for each row execute function public._corruption_on_bill_enacted();

-- ---------- Investigations weighted by exposure ----------
create or replace function public.investigate_player(p_target uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  cost numeric := 500000;
  w record;
  new_bal numeric;
  last_at timestamptz;
  entries jsonb;
  exposure numeric := 0;
  pick_limit int := 1;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if p_target is null then raise exception 'Target required'; end if;
  if not public._can_investigate(v_uid) then
    raise exception 'You lack authority to investigate (president, senate leadership, or $500M+ wallet required)';
  end if;

  select last_investigation_at into last_at from public.investigation_cooldowns where investigator_user_id = v_uid;
  if last_at is not null and now() < last_at + interval '24 hours' then
    raise exception 'Investigation cooldown — try again after 24 hours';
  end if;

  select coalesce(ep.exposure_risk, 0) into exposure
  from public.economy_pacs ep where ep.user_id = p_target;
  pick_limit := 1 + least(3, floor(exposure / 25)::int);

  insert into public.economy_wallets (user_id) values (v_uid) on conflict do nothing;
  select * into w from public.economy_wallets where user_id = v_uid for update;
  if w.balance < cost then raise exception 'Investigation costs $500,000'; end if;

  new_bal := w.balance - cost;
  update public.economy_wallets set balance = new_bal, updated_at = now() where user_id = v_uid;

  insert into public.investigation_cooldowns (investigator_user_id, last_investigation_at)
  values (v_uid, now())
  on conflict (investigator_user_id) do update set last_investigation_at = now();

  with picked as (
    select cl.id, cl.action_type, cl.amount, cl.created_at, cl.metadata
    from public.corruption_ledger cl
    where cl.actor_user_id = p_target and cl.is_exposed = false
    order by random()
    limit pick_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'action_type', p.action_type, 'amount', p.amount, 'created_at', p.created_at, 'metadata', p.metadata
  )), '[]'::jsonb) into entries from picked p;

  update public.corruption_ledger cl
  set found_by_user_id = v_uid
  where cl.id in (select (e->>'id')::uuid from jsonb_array_elements(entries) e);

  insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
  values (v_uid, -cost, new_bal, 'investigation', jsonb_build_object('target', p_target, 'pick_limit', pick_limit));

  return jsonb_build_object('ok', true, 'entries', entries, 'balance', new_bal, 'pick_limit', pick_limit);
end;
$$;

-- Insider flag on sell before sector bills pass.
create or replace function public.sell_stock(p_business uuid, p_shares integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  qty int := greatest(1, coalesce(p_shares, 0));
  biz record;
  holding record;
  proceeds numeric;
  w record;
  new_bal numeric;
  new_price numeric;
  new_premium numeric;
  open_bill record;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  perform public._economy_require_active_budget();

  select * into holding from public.stock_holdings where user_id = v_uid and business_id = p_business for update;
  if holding.shares is null or holding.shares < qty then raise exception 'Insufficient shares'; end if;

  select * into biz from public.businesses where id = p_business for update;
  proceeds := round(qty * biz.price_per_share, 2);
  if biz.treasury < proceeds then raise exception 'Business treasury cannot cover sale ($% available)', biz.treasury; end if;

  select b.id, b.title into open_bill
  from public.bill_votes bv
  join public.bills b on b.id = bv.bill_id
  where bv.voter_id = v_uid
    and b.sector_tag = biz.sector
    and b.status not in ('law', 'vetoed', 'dead', 'rejected', 'expired', 'failed')
  limit 1;
  if open_bill.id is not null then
    insert into public.corruption_ledger (actor_user_id, action_type, amount, metadata)
    values (
      v_uid, 'short_insider', proceeds,
      jsonb_build_object('business_id', p_business, 'business_name', biz.name, 'sector', biz.sector, 'bill_id', open_bill.id, 'bill_title', open_bill.title)
    );
    perform public._bump_exposure_risk(v_uid, 6);
  end if;

  update public.stock_holdings set shares = shares - qty where user_id = v_uid and business_id = p_business;
  delete from public.stock_holdings where user_id = v_uid and business_id = p_business and shares = 0;

  new_premium := public._business_apply_trade_premium(biz.market_premium, qty, false);
  update public.businesses
  set shares_available = shares_available + qty, treasury = treasury - proceeds, market_premium = new_premium
  where id = p_business;
  new_price := public._business_refresh_share_price(p_business);

  insert into public.economy_wallets (user_id) values (v_uid) on conflict do nothing;
  select * into w from public.economy_wallets where user_id = v_uid for update;
  new_bal := w.balance + proceeds;
  update public.economy_wallets set balance = new_bal, updated_at = now() where user_id = v_uid;

  insert into public.stock_trades (user_id, business_id, trade_type, shares, price_at_trade, total_value, is_disclosed)
  values (v_uid, p_business, 'sell', qty, biz.price_per_share, proceeds, holding.shares >= ceil(biz.total_shares * 0.05));

  return jsonb_build_object('ok', true, 'balance', new_bal, 'proceeds', proceeds, 'price_per_share', new_price, 'market_premium', new_premium);
end;
$$;

-- ---------- Election rigging ----------
create or replace function public.corruption_rig_election(
  p_election uuid,
  p_candidate uuid,
  p_kind text default 'ballot_stuffing'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  kind text := lower(trim(coalesce(p_kind, 'ballot_stuffing')));
  cand record;
  race record;
  cost numeric;
  w record;
  new_bal numeric;
  opponent record;
  hit boolean := true;
  exposure_add numeric := 10;
  pts_self numeric := 0;
  pts_opp numeric := 0;
  action_type text := 'election_rig';
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  perform public._economy_require_active_budget();

  select ec.id, ec.user_id, ec.election_id, ec.campaign_points_total
    into cand
  from public.election_candidates ec
  where ec.id = p_candidate and ec.election_id = p_election and coalesce(ec.is_npc, false) = false;
  if cand.id is null or cand.user_id <> v_uid then raise exception 'Must rig your own candidacy'; end if;

  select e.phase, e.general_closes_at into race from public.elections e where e.id = p_election;
  if race.phase <> 'general' then raise exception 'Election rigging only during general election'; end if;
  if race.general_closes_at is not null and now() > race.general_closes_at then raise exception 'Election closed'; end if;

  cost := case kind
    when 'ballot_stuffing' then 2500000
    when 'voter_intimidation' then 3000000
    when 'official_bribe' then 5000000
    else null
  end;
  if cost is null then raise exception 'Unknown rig kind'; end if;

  insert into public.economy_wallets (user_id) values (v_uid) on conflict do nothing;
  select * into w from public.economy_wallets where user_id = v_uid for update;
  if w.balance < cost then raise exception 'Insufficient balance ($% required)', cost; end if;

  if kind = 'official_bribe' then
    hit := random() < 0.55;
    if hit then
      pts_self := 5;
      action_type := 'election_rig';
    else
      exposure_add := 25;
      action_type := 'fec_audit';
      perform public._corruption_wire_story(
        'economy_corruption_exposed',
        'Election officials scrutinize suspicious payments',
        'Anonymous officials flagged unusual transfers tied to an active House race.',
        jsonb_build_object('election_id', p_election, 'kind', kind)
      );
    end if;
  elsif kind = 'voter_intimidation' then
    action_type := 'voter_intimidation';
    pts_opp := 2;
    exposure_add := 14;
  else
    action_type := 'ballot_harvesting';
    pts_self := 3;
    exposure_add := 9;
  end if;

  if pts_self > 0 then
    update public.election_candidates
    set campaign_points_total = coalesce(campaign_points_total, 0) + pts_self
    where id = p_candidate;
  end if;

  if pts_opp > 0 then
    select ec.id into opponent
    from public.election_candidates ec
    where ec.election_id = p_election and ec.id <> p_candidate and coalesce(ec.primary_winner, true) = true
    order by ec.is_npc desc, ec.id
    limit 1;
    if opponent.id is not null then
      update public.election_candidates
      set campaign_points_total = greatest(0, coalesce(campaign_points_total, 0) - pts_opp)
      where id = opponent.id;
    end if;
  end if;

  new_bal := w.balance - cost;
  update public.economy_wallets set balance = new_bal, updated_at = now() where user_id = v_uid;

  insert into public.corruption_ledger (actor_user_id, election_id, action_type, amount, metadata)
  values (v_uid, p_election, action_type, cost, jsonb_build_object('candidate_id', p_candidate, 'kind', kind, 'points_self', pts_self, 'points_opponent', pts_opp));

  perform public._bump_exposure_risk(v_uid, exposure_add);

  insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
  values (v_uid, -cost, new_bal, 'corruption', jsonb_build_object('action', action_type, 'election_id', p_election));

  return jsonb_build_object('ok', true, 'balance', new_bal, 'kind', kind, 'points_self', pts_self, 'points_opponent', pts_opp, 'caught', kind = 'official_bribe' and not hit);
end;
$$;

-- Opposition research: boosts next attack ad odds (logged; economy ad RPC unchanged but metadata hook).
create or replace function public.corruption_opposition_research(p_election uuid, p_target_candidate uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  cost numeric := 750000;
  w record;
  new_bal numeric;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  perform public._economy_require_active_budget();

  insert into public.economy_wallets (user_id) values (v_uid) on conflict do nothing;
  select * into w from public.economy_wallets where user_id = v_uid for update;
  if w.balance < cost then raise exception 'Insufficient balance'; end if;

  new_bal := w.balance - cost;
  update public.economy_wallets set balance = new_bal, updated_at = now() where user_id = v_uid;

  insert into public.corruption_ledger (actor_user_id, target_user_id, election_id, action_type, amount, metadata)
  select v_uid, ec.user_id, p_election, 'opposition_research', cost,
    jsonb_build_object('target_candidate_id', p_target_candidate, 'attack_bonus', 0.15)
  from public.election_candidates ec where ec.id = p_target_candidate;

  perform public._bump_exposure_risk(v_uid, 5);

  return jsonb_build_object('ok', true, 'balance', new_bal, 'message', 'Opposition research filed — your next attack spot gets better odds.');
end;
$$;

-- Fake endorsement
create or replace function public.corruption_fake_endorsement(p_election uuid, p_candidate uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  cost numeric := 1200000;
  w record;
  new_bal numeric;
  caught boolean;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  perform public._economy_require_active_budget();

  insert into public.economy_wallets (user_id) values (v_uid) on conflict do nothing;
  select * into w from public.economy_wallets where user_id = v_uid for update;
  if w.balance < cost then raise exception 'Insufficient balance'; end if;

  caught := random() < 0.25;
  new_bal := w.balance - cost;
  update public.economy_wallets set balance = new_bal, updated_at = now() where user_id = v_uid;

  if caught then
    insert into public.corruption_ledger (actor_user_id, election_id, action_type, amount, metadata)
    values (v_uid, p_election, 'fake_endorsement', cost, jsonb_build_object('candidate_id', p_candidate, 'caught', true));
    perform public._bump_exposure_risk(v_uid, 18);
    perform public._corruption_wire_story('economy_corruption_exposed', 'Fabricated endorsement discovered', 'Party operatives flagged a forged leadership endorsement in an active race.', jsonb_build_object('election_id', p_election));
    return jsonb_build_object('ok', false, 'balance', new_bal, 'caught', true);
  end if;

  update public.election_candidates
  set campaign_points_total = coalesce(campaign_points_total, 0) + 8
  where id = p_candidate;

  insert into public.corruption_ledger (actor_user_id, election_id, action_type, amount, metadata)
  values (v_uid, p_election, 'fake_endorsement', cost, jsonb_build_object('candidate_id', p_candidate, 'points', 8));

  perform public._bump_exposure_risk(v_uid, 7);
  return jsonb_build_object('ok', true, 'balance', new_bal, 'points', 8);
end;
$$;

-- Bribe colleague to flip vote
create or replace function public.corruption_bribe_vote(
  p_bill uuid,
  p_colleague uuid,
  p_amount numeric,
  p_desired_vote text default 'yea'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  amt numeric := round(greatest(coalesce(p_amount, 0), 0), 2);
  w_from record;
  w_to record;
  new_from numeric;
  new_to numeric;
  desired text := lower(trim(coalesce(p_desired_vote, 'yea')));
  bill_row record;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if p_colleague is null or p_colleague = v_uid then raise exception 'Invalid colleague'; end if;
  if amt < 500000 then raise exception 'Minimum bribe is $500,000'; end if;
  perform public._economy_require_active_budget();

  select b.id, b.title, b.sector_tag into bill_row from public.bills b where b.id = p_bill;
  if bill_row.id is null then raise exception 'Bill not found'; end if;

  insert into public.economy_wallets (user_id) values (v_uid) on conflict do nothing;
  insert into public.economy_wallets (user_id) values (p_colleague) on conflict do nothing;
  select * into w_from from public.economy_wallets where user_id = v_uid for update;
  if w_from.balance < amt then raise exception 'Insufficient balance'; end if;
  select * into w_to from public.economy_wallets where user_id = p_colleague for update;

  new_from := w_from.balance - amt;
  new_to := w_to.balance + amt;
  update public.economy_wallets set balance = new_from, updated_at = now() where user_id = v_uid;
  update public.economy_wallets set balance = new_to, updated_at = now() where user_id = p_colleague;

  insert into public.corruption_ledger (actor_user_id, target_user_id, action_type, amount, metadata)
  values (v_uid, p_colleague, 'vote_bribe', amt, jsonb_build_object('bill_id', p_bill, 'bill_title', bill_row.title, 'desired_vote', desired));

  update public.bill_votes
  set vote = desired
  where bill_id = p_bill and voter_id = p_colleague;

  perform public._bump_exposure_risk(v_uid, 12);

  return jsonb_build_object('ok', true, 'balance', new_from, 'colleague_paid', amt);
end;
$$;

-- Government contract kickback after voting yea on sector bill while holding stock
create or replace function public.corruption_claim_contract(p_bill uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  bill_row record;
  h record;
  payout numeric;
  w record;
  new_bal numeric;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  select b.id, b.title, b.sector_tag into bill_row
  from public.bills b
  join public.bill_votes bv on bv.bill_id = b.id and bv.voter_id = v_uid and bv.vote = 'yea'
  where b.id = p_bill and b.sector_tag is not null;
  if bill_row.id is null then raise exception 'You must have voted YEA on a sector-tagged bill'; end if;

  select sh.shares, b.id as business_id, b.name into h
  from public.stock_holdings sh
  join public.businesses b on b.id = sh.business_id and b.sector = bill_row.sector_tag
  where sh.user_id = v_uid and sh.shares > 0
  order by sh.shares desc
  limit 1;
  if h.shares is null then raise exception 'Hold stock in the bill sector to claim contracts'; end if;

  payout := round(greatest(250000, h.shares * 15000), 2);

  insert into public.economy_wallets (user_id) values (v_uid) on conflict do nothing;
  select * into w from public.economy_wallets where user_id = v_uid for update;
  new_bal := w.balance + payout;
  update public.economy_wallets set balance = new_bal, updated_at = now() where user_id = v_uid;

  insert into public.corruption_ledger (actor_user_id, action_type, amount, metadata)
  values (v_uid, 'government_contract', payout, jsonb_build_object('bill_id', bill_row.id, 'bill_title', bill_row.title, 'sector', bill_row.sector_tag, 'business_id', h.business_id, 'shares', h.shares));

  perform public._bump_exposure_risk(v_uid, 8);

  return jsonb_build_object('ok', true, 'balance', new_bal, 'payout', payout);
end;
$$;

-- Pump own business stock
create or replace function public.corruption_pump_stock(p_business uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  biz record;
  cost numeric := 2000000;
  w record;
  new_bal numeric;
  new_price numeric;
  caught boolean;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  perform public._economy_require_active_budget();

  select * into biz from public.businesses where id = p_business for update;
  if biz.owner_user_id <> v_uid then raise exception 'You must own the business'; end if;

  insert into public.economy_wallets (user_id) values (v_uid) on conflict do nothing;
  select * into w from public.economy_wallets where user_id = v_uid for update;
  if w.balance < cost then raise exception 'Insufficient balance'; end if;

  caught := random() < 0.3;
  new_bal := w.balance - cost;
  update public.economy_wallets set balance = new_bal, updated_at = now() where user_id = v_uid;

  if caught then
    insert into public.corruption_ledger (actor_user_id, action_type, amount, metadata)
    values (v_uid, 'pump_and_dump', cost, jsonb_build_object('business_id', p_business, 'caught', true));
    perform public._bump_exposure_risk(v_uid, 20);
    perform public._corruption_wire_story('economy_corruption_exposed', 'Market manipulation probe opened', 'Regulators are reviewing suspicious trading in a player-owned company.', jsonb_build_object('business_id', p_business));
    return jsonb_build_object('ok', false, 'balance', new_bal, 'caught', true);
  end if;

  update public.businesses
  set market_premium = least(4.0, coalesce(market_premium, 1) * 1.18)
  where id = p_business;
  new_price := public._business_refresh_share_price(p_business);

  insert into public.corruption_ledger (actor_user_id, action_type, amount, metadata)
  values (v_uid, 'pump_and_dump', cost, jsonb_build_object('business_id', p_business, 'price_per_share', new_price));

  perform public._bump_exposure_risk(v_uid, 11);
  return jsonb_build_object('ok', true, 'balance', new_bal, 'price_per_share', new_price);
end;
$$;

-- Divert party treasury
create or replace function public.corruption_party_divert(p_amount numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  amt numeric := round(greatest(coalesce(p_amount, 0), 0), 2);
  prof record;
  party_row record;
  w record;
  new_bal numeric;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if amt < 1000000 then raise exception 'Minimum diversion is $1,000,000'; end if;

  select party into prof from public.profiles where id = v_uid;
  if prof.party not in ('democrat', 'republican') then raise exception 'Must belong to a major party'; end if;

  select * into party_row from public.party_organizations where party_key = prof.party for update;
  if party_row.treasury_balance < amt then raise exception 'Party treasury insufficient'; end if;

  update public.party_organizations set treasury_balance = treasury_balance - amt where party_key = prof.party;

  insert into public.economy_wallets (user_id) values (v_uid) on conflict do nothing;
  select * into w from public.economy_wallets where user_id = v_uid for update;
  new_bal := w.balance + amt;
  update public.economy_wallets set balance = new_bal, updated_at = now() where user_id = v_uid;

  insert into public.corruption_ledger (actor_user_id, action_type, amount, metadata)
  values (v_uid, 'party_treasury_divert', amt, jsonb_build_object('party', prof.party));

  perform public._bump_exposure_risk(v_uid, 15);
  return jsonb_build_object('ok', true, 'balance', new_bal, 'diverted', amt);
end;
$$;

-- Foreign PAC contribution
create or replace function public.corruption_foreign_money(p_election uuid, p_candidate uuid, p_amount numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  amt numeric := round(greatest(coalesce(p_amount, 0), 0), 2);
  pac_row record;
  new_treasury numeric;
  pts numeric;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if amt < 500000 then raise exception 'Minimum foreign conduit is $500,000'; end if;

  select * into pac_row from public.economy_pacs where user_id = v_uid for update;
  if pac_row.user_id is null then raise exception 'Register a PAC first'; end if;
  if pac_row.treasury_balance < amt then raise exception 'PAC treasury insufficient'; end if;

  new_treasury := pac_row.treasury_balance - amt;
  pts := floor(amt / 250000);
  update public.economy_pacs set treasury_balance = new_treasury where user_id = v_uid;
  update public.election_candidates set campaign_points_total = coalesce(campaign_points_total, 0) + pts where id = p_candidate;

  insert into public.corruption_ledger (actor_user_id, election_id, action_type, amount, metadata)
  values (v_uid, p_election, 'foreign_money', amt, jsonb_build_object('candidate_id', p_candidate, 'points', pts));

  perform public._bump_exposure_risk(v_uid, 22);
  return jsonb_build_object('ok', true, 'treasury', new_treasury, 'points', pts);
end;
$$;

-- Super-PAC launder through intermediary
create or replace function public.corruption_super_pac_launder(
  p_intermediary uuid,
  p_election uuid,
  p_candidate uuid,
  p_amount numeric
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
  w_int record;
  new_treasury numeric;
  pts numeric;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if p_intermediary is null or p_intermediary = v_uid then raise exception 'Pick another player as intermediary'; end if;
  if amt < 750000 then raise exception 'Minimum launder amount is $750,000'; end if;

  select * into pac_row from public.economy_pacs where user_id = v_uid for update;
  if pac_row.treasury_balance < amt then raise exception 'PAC treasury insufficient'; end if;

  new_treasury := pac_row.treasury_balance - amt;
  update public.economy_pacs set treasury_balance = new_treasury where user_id = v_uid;

  insert into public.economy_wallets (user_id) values (p_intermediary) on conflict do nothing;
  select * into w_int from public.economy_wallets where user_id = p_intermediary for update;
  update public.economy_wallets set balance = w_int.balance + round(amt * 0.05, 2), updated_at = now() where user_id = p_intermediary;

  pts := floor(amt / 400000);
  update public.election_candidates set campaign_points_total = coalesce(campaign_points_total, 0) + pts where id = p_candidate;

  insert into public.corruption_ledger (actor_user_id, target_user_id, election_id, action_type, amount, metadata)
  values (v_uid, p_intermediary, p_election, 'super_pac_launder', amt, jsonb_build_object('candidate_id', p_candidate, 'points', pts));

  perform public._bump_exposure_risk(v_uid, 16);
  return jsonb_build_object('ok', true, 'treasury', new_treasury, 'points', pts);
end;
$$;

-- Backroom deal proposal
create or replace function public.corruption_propose_deal(
  p_counterparty uuid,
  p_amount numeric,
  p_terms text,
  p_bill uuid default null,
  p_election uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  amt numeric := round(greatest(coalesce(p_amount, 0), 0), 2);
  deal_id uuid;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if p_counterparty is null or p_counterparty = v_uid then raise exception 'Invalid counterparty'; end if;
  if amt < 250000 then raise exception 'Minimum deal sweetener is $250,000'; end if;
  if coalesce(trim(p_terms), '') = '' then raise exception 'Describe the deal terms'; end if;

  insert into public.corruption_deals (proposer_user_id, counterparty_user_id, amount, terms, bill_id, election_id)
  values (v_uid, p_counterparty, amt, trim(p_terms), p_bill, p_election)
  returning id into deal_id;

  return jsonb_build_object('ok', true, 'deal_id', deal_id);
end;
$$;

create or replace function public.corruption_respond_deal(p_deal uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  d record;
  w_from record;
  w_to record;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select * into d from public.corruption_deals where id = p_deal for update;
  if d.id is null then raise exception 'Deal not found'; end if;
  if d.counterparty_user_id <> v_uid then raise exception 'Not your deal to accept'; end if;
  if d.status <> 'pending' then raise exception 'Deal already resolved'; end if;

  if not p_accept then
    update public.corruption_deals set status = 'rejected', resolved_at = now() where id = p_deal;
    return jsonb_build_object('ok', true, 'accepted', false);
  end if;

  insert into public.economy_wallets (user_id) values (d.proposer_user_id) on conflict do nothing;
  insert into public.economy_wallets (user_id) values (d.counterparty_user_id) on conflict do nothing;
  select * into w_from from public.economy_wallets where user_id = d.proposer_user_id for update;
  if w_from.balance < d.amount then raise exception 'Proposer cannot cover the deal'; end if;
  select * into w_to from public.economy_wallets where user_id = d.counterparty_user_id for update;

  update public.economy_wallets set balance = w_from.balance - d.amount, updated_at = now() where user_id = d.proposer_user_id;
  update public.economy_wallets set balance = w_to.balance + d.amount, updated_at = now() where user_id = d.counterparty_user_id;

  update public.corruption_deals set status = 'accepted', resolved_at = now() where id = p_deal;

  insert into public.corruption_ledger (actor_user_id, target_user_id, action_type, amount, metadata)
  values (d.proposer_user_id, d.counterparty_user_id, 'backroom_deal', d.amount, jsonb_build_object('deal_id', p_deal, 'terms', d.terms, 'bill_id', d.bill_id, 'election_id', d.election_id));

  perform public._bump_exposure_risk(d.proposer_user_id, 10);
  perform public._bump_exposure_risk(d.counterparty_user_id, 6);

  return jsonb_build_object('ok', true, 'accepted', true, 'amount', d.amount);
end;
$$;

-- Whistleblower tip (pay to increase expose chance on target)
create or replace function public.corruption_whistleblower_tip(p_target uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  cost numeric := 350000;
  w record;
  new_bal numeric;
  entry_id uuid;
  exposed boolean := false;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if p_target is null then raise exception 'Target required'; end if;

  insert into public.economy_wallets (user_id) values (v_uid) on conflict do nothing;
  select * into w from public.economy_wallets where user_id = v_uid for update;
  if w.balance < cost then raise exception 'Insufficient balance'; end if;

  new_bal := w.balance - cost;
  update public.economy_wallets set balance = new_bal, updated_at = now() where user_id = v_uid;

  select cl.id into entry_id
  from public.corruption_ledger cl
  where cl.actor_user_id = p_target and cl.is_exposed = false
  order by random()
  limit 1;

  if entry_id is not null and random() < 0.35 then
    update public.corruption_ledger
    set is_exposed = true, exposed_at = now(), exposed_by_user_id = v_uid
    where id = entry_id;
    update public.profiles
    set approval_rating = greatest(0, coalesce(approval_rating, 50) - 15), updated_at = now()
    where id = p_target;
    perform public._corruption_wire_story(
      'economy_corruption_exposed',
      'Whistleblower surfaces hidden ledger activity',
      'An anonymous tip led investigators to undisclosed political spending.',
      jsonb_build_object('actor_user_id', p_target, 'entry_id', entry_id)
    );
    exposed := true;
  end if;

  insert into public.corruption_ledger (actor_user_id, target_user_id, action_type, amount, metadata)
  values (v_uid, p_target, 'whistleblower_leak', cost, jsonb_build_object('auto_exposed', exposed, 'entry_id', entry_id));

  return jsonb_build_object('ok', true, 'balance', new_bal, 'exposed', exposed);
end;
$$;

-- NPC fixer reduces exposure
create or replace function public.corruption_npc_fixer(p_amount numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  amt numeric := round(greatest(coalesce(p_amount, 0), 0), 2);
  w record;
  new_bal numeric;
  new_risk numeric;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if amt < 500000 then raise exception 'Fixers start at $500,000'; end if;

  insert into public.economy_wallets (user_id) values (v_uid) on conflict do nothing;
  select * into w from public.economy_wallets where user_id = v_uid for update;
  if w.balance < amt then raise exception 'Insufficient balance'; end if;

  new_bal := w.balance - amt;
  update public.economy_wallets set balance = new_bal, updated_at = now() where user_id = v_uid;

  update public.economy_pacs
  set exposure_risk = greatest(0, exposure_risk - least(25, amt / 100000)), updated_at = now()
  where user_id = v_uid
  returning exposure_risk into new_risk;

  insert into public.corruption_ledger (actor_user_id, action_type, amount, metadata)
  values (v_uid, 'fixer_payment', amt, jsonb_build_object('exposure_after', coalesce(new_risk, 0)));

  return jsonb_build_object('ok', true, 'balance', new_bal, 'exposure_risk', coalesce(new_risk, 0));
end;
$$;

-- Committee hold / bottle bill
create or replace function public.corruption_committee_hold(p_bill uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  cost numeric := 1500000;
  w record;
  new_bal numeric;
  bill_row record;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  perform public._economy_require_active_budget();

  select id, title, status into bill_row from public.bills where id = p_bill for update;
  if bill_row.id is null then raise exception 'Bill not found'; end if;

  insert into public.economy_wallets (user_id) values (v_uid) on conflict do nothing;
  select * into w from public.economy_wallets where user_id = v_uid for update;
  if w.balance < cost then raise exception 'Insufficient balance'; end if;

  new_bal := w.balance - cost;
  update public.economy_wallets set balance = new_bal, updated_at = now() where user_id = v_uid;

  update public.bills
  set status = 'leadership_review'::public.bill_status
  where id = p_bill and status in ('house_floor', 'senate_floor', 'debate', 'other_chamber_debate');

  insert into public.corruption_ledger (actor_user_id, action_type, amount, metadata)
  values (v_uid, 'committee_bribe', cost, jsonb_build_object('bill_id', p_bill, 'bill_title', bill_row.title));

  perform public._bump_exposure_risk(v_uid, 9);
  return jsonb_build_object('ok', true, 'balance', new_bal);
end;
$$;

-- In-kind coordination (business pays for independent expenditure)
create or replace function public.corruption_in_kind_ad(p_election uuid, p_candidate uuid, p_business uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  biz record;
  cost numeric := 1800000;
  pts numeric := 6;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  perform public._economy_require_active_budget();

  select * into biz from public.businesses where id = p_business and owner_user_id = v_uid for update;
  if biz.id is null then raise exception 'You must own the business'; end if;
  if biz.treasury < cost then raise exception 'Business treasury cannot cover in-kind buy'; end if;

  update public.businesses set treasury = treasury - cost where id = p_business;
  update public.election_candidates set campaign_points_total = coalesce(campaign_points_total, 0) + pts where id = p_candidate;

  insert into public.corruption_ledger (actor_user_id, election_id, action_type, amount, metadata)
  values (v_uid, p_election, 'in_kind_coordination', cost, jsonb_build_object('candidate_id', p_candidate, 'business_id', p_business, 'points', pts));

  perform public._bump_exposure_risk(v_uid, 13);
  return jsonb_build_object('ok', true, 'points', pts, 'treasury', biz.treasury - cost);
end;
$$;

-- Immunity: expose one entry to destroy another (sacrifice)
create or replace function public.corruption_immunity_trade(p_sacrifice_entry uuid, p_hide_entry uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  sac record;
  hid record;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  select * into sac from public.corruption_ledger where id = p_sacrifice_entry and actor_user_id = v_uid;
  select * into hid from public.corruption_ledger where id = p_hide_entry and actor_user_id = v_uid;
  if sac.id is null or hid.id is null then raise exception 'Both entries must be yours'; end if;

  update public.corruption_ledger set is_exposed = true, exposed_at = now(), exposed_by_user_id = v_uid where id = p_sacrifice_entry;
  delete from public.corruption_ledger where id = p_hide_entry;

  insert into public.corruption_ledger (actor_user_id, action_type, metadata)
  values (v_uid, 'immunity_deal', jsonb_build_object('sacrificed', p_sacrifice_entry, 'hidden', p_hide_entry));

  perform public._bump_exposure_risk(v_uid, 5);
  return jsonb_build_object('ok', true);
end;
$$;

-- Maintenance: blackmail expiry + random FEC audits
create or replace function public.process_corruption_maintenance()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n_blackmail int := 0;
  n_audit int := 0;
  d record;
  target record;
  entry_id uuid;
begin
  n_blackmail := public.process_expired_blackmail();

  for target in
    select ep.user_id, ep.exposure_risk
    from public.economy_pacs ep
    where ep.exposure_risk >= 40
    order by random()
    limit 3
  loop
    if random() < (target.exposure_risk / 100.0) then
      select cl.id into entry_id
      from public.corruption_ledger cl
      where cl.actor_user_id = target.user_id and cl.is_exposed = false
      order by random()
      limit 1;
      if entry_id is not null then
        update public.corruption_ledger
        set is_exposed = true, exposed_at = now(), exposed_by_user_id = null
        where id = entry_id;
        update public.profiles
        set approval_rating = greatest(0, coalesce(approval_rating, 50) - 10), updated_at = now()
        where id = target.user_id;
        perform public._corruption_wire_story(
          'economy_corruption_exposed',
          'FEC audit exposes undisclosed activity',
          'Federal investigators surfaced hidden ledger activity tied to a major donor.',
          jsonb_build_object('actor_user_id', target.user_id, 'entry_id', entry_id)
        );
        n_audit := n_audit + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object('blackmail_processed', n_blackmail, 'fec_audits', n_audit);
end;
$$;

-- Player dossier for corruption hub
create or replace function public.corruption_my_dossier()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  hidden_count int;
  exposed_count int;
  found_entries jsonb;
  pending_deals jsonb;
  exposure numeric := 0;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  select count(*)::int into hidden_count from public.corruption_ledger where actor_user_id = v_uid and is_exposed = false;
  select count(*)::int into exposed_count from public.corruption_ledger where actor_user_id = v_uid and is_exposed = true;
  select coalesce(ep.exposure_risk, 0) into exposure from public.economy_pacs ep where user_id = v_uid;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', cl.id, 'action_type', cl.action_type, 'amount', cl.amount, 'created_at', cl.created_at, 'metadata', cl.metadata
  ) order by cl.created_at desc), '[]'::jsonb)
  into found_entries
  from public.corruption_ledger cl
  where cl.found_by_user_id = v_uid and cl.is_exposed = false
  limit 20;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id, 'proposer_user_id', d.proposer_user_id, 'amount', d.amount, 'terms', d.terms, 'created_at', d.created_at
  ) order by d.created_at desc), '[]'::jsonb)
  into pending_deals
  from public.corruption_deals d
  where d.counterparty_user_id = v_uid and d.status = 'pending'
  limit 10;

  return jsonb_build_object(
    'hidden_count', hidden_count,
    'exposed_count', exposed_count,
    'exposure_risk', exposure,
    'found_entries', found_entries,
    'pending_deals', pending_deals
  );
end;
$$;

grant execute on function public.corruption_rig_election(uuid, uuid, text) to authenticated;
grant execute on function public.corruption_opposition_research(uuid, uuid) to authenticated;
grant execute on function public.corruption_fake_endorsement(uuid, uuid) to authenticated;
grant execute on function public.corruption_bribe_vote(uuid, uuid, numeric, text) to authenticated;
grant execute on function public.corruption_claim_contract(uuid) to authenticated;
grant execute on function public.corruption_pump_stock(uuid) to authenticated;
grant execute on function public.corruption_party_divert(numeric) to authenticated;
grant execute on function public.corruption_foreign_money(uuid, uuid, numeric) to authenticated;
grant execute on function public.corruption_super_pac_launder(uuid, uuid, uuid, numeric) to authenticated;
grant execute on function public.corruption_propose_deal(uuid, numeric, text, uuid, uuid) to authenticated;
grant execute on function public.corruption_respond_deal(uuid, boolean) to authenticated;
grant execute on function public.corruption_whistleblower_tip(uuid) to authenticated;
grant execute on function public.corruption_npc_fixer(numeric) to authenticated;
grant execute on function public.corruption_committee_hold(uuid) to authenticated;
grant execute on function public.corruption_in_kind_ad(uuid, uuid, uuid) to authenticated;
grant execute on function public.corruption_immunity_trade(uuid, uuid) to authenticated;
grant execute on function public.process_corruption_maintenance() to authenticated, service_role;
grant execute on function public.corruption_my_dossier() to authenticated;

notify pgrst, 'reload schema';
