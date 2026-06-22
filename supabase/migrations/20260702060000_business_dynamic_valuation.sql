-- Dynamic business valuation: book value (treasury + founding capital) × market premium (moves on trades).

alter table public.businesses
  add column if not exists market_premium numeric(10, 4) not null default 1.0
    check (market_premium >= 0.25 and market_premium <= 4.0);

create or replace function public._business_book_per_share(p_treasury numeric, p_founding numeric, p_total_shares int)
returns numeric
language sql
immutable
as $$
  select greatest(0.01, (greatest(coalesce(p_treasury, 0), 0) + greatest(coalesce(p_founding, 0), 0)) / greatest(p_total_shares, 1));
$$;

create or replace function public._business_apply_trade_premium(p_premium numeric, p_shares int, p_is_buy boolean)
returns numeric
language sql
immutable
as $$
  select least(
    4.0,
    greatest(
      0.25,
      coalesce(p_premium, 1.0) * (1 + (case when p_is_buy then 1 else -1 end) * 0.005 * (greatest(coalesce(p_shares, 0), 0)::numeric / 100.0))
    )
  );
$$;

create or replace function public._business_refresh_share_price(p_business_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  biz record;
  new_price numeric;
begin
  select * into biz from public.businesses where id = p_business_id for update;
  if biz.id is null then return 0; end if;

  new_price := round(
    public._business_book_per_share(biz.treasury, biz.founding_capital, biz.total_shares) * coalesce(biz.market_premium, 1.0),
    4
  );

  update public.businesses
  set price_per_share = new_price
  where id = p_business_id;

  return new_price;
end;
$$;

-- Owner can grow book value without trading hype
create or replace function public.invest_in_business(p_business uuid, p_amount numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  amt numeric := round(greatest(coalesce(p_amount, 0), 0), 2);
  biz record;
  w record;
  new_bal numeric;
  new_price numeric;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  perform public._economy_require_active_budget();
  if amt <= 0 then raise exception 'Amount must be positive'; end if;

  select * into biz from public.businesses where id = p_business for update;
  if biz.id is null then raise exception 'Business not found'; end if;
  if biz.owner_user_id <> v_uid then raise exception 'Only the owner may invest in treasury'; end if;

  insert into public.economy_wallets (user_id) values (v_uid) on conflict do nothing;
  select * into w from public.economy_wallets where user_id = v_uid for update;
  if w.balance < amt then raise exception 'Insufficient balance'; end if;

  new_bal := w.balance - amt;
  update public.economy_wallets set balance = new_bal, updated_at = now() where user_id = v_uid;
  update public.businesses set treasury = treasury + amt where id = p_business;

  new_price := public._business_refresh_share_price(p_business);

  insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
  values (v_uid, -amt, new_bal, 'business_investment', jsonb_build_object('business_id', p_business, 'price_per_share', new_price));

  return jsonb_build_object('ok', true, 'balance', new_bal, 'treasury', biz.treasury + amt, 'price_per_share', new_price);
end;
$$;

grant execute on function public.invest_in_business(uuid, numeric) to authenticated;

create or replace function public.found_business(
  p_name text,
  p_sector public.business_sector,
  p_capital numeric,
  p_shares_listed integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  cap numeric := round(greatest(coalesce(p_capital, 0), 0), 2);
  listed int := greatest(0, coalesce(p_shares_listed, 0));
  w record;
  new_bal numeric;
  biz_id uuid;
  founder_shares int;
  new_price numeric;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  perform public._economy_require_active_budget();
  if cap < 20000000 then raise exception 'Minimum founding capital is $20,000,000'; end if;
  if listed < 0 or listed > 10000 then raise exception 'Listed shares must be 0–10,000'; end if;

  founder_shares := 10000 - listed;
  if founder_shares < 1 then raise exception 'Founder must retain at least 1 share'; end if;

  insert into public.economy_wallets (user_id) values (v_uid) on conflict do nothing;
  select * into w from public.economy_wallets where user_id = v_uid for update;
  if w.balance < cap then raise exception 'Insufficient balance'; end if;

  new_bal := w.balance - cap;
  update public.economy_wallets set balance = new_bal, updated_at = now() where user_id = v_uid;

  insert into public.businesses (
    owner_user_id, name, sector, founding_capital, total_shares,
    shares_available, price_per_share, treasury, market_premium
  ) values (
    v_uid, trim(p_name), p_sector, cap, 10000, listed, 1, 0, 1.0
  ) returning id into biz_id;

  new_price := public._business_refresh_share_price(biz_id);

  insert into public.stock_holdings (user_id, business_id, shares) values (v_uid, biz_id, founder_shares);

  insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
  values (v_uid, -cap, new_bal, 'found_business', jsonb_build_object('business_id', biz_id, 'sector', p_sector, 'price_per_share', new_price));

  return jsonb_build_object('ok', true, 'business_id', biz_id, 'price_per_share', new_price, 'balance', new_bal);
end;
$$;

create or replace function public.buy_stock(p_business uuid, p_shares integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  qty int := greatest(1, coalesce(p_shares, 0));
  biz record;
  cost numeric;
  w record;
  new_bal numeric;
  held int;
  new_price numeric;
  disclosed boolean;
  pending_bill uuid;
  new_premium numeric;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  perform public._economy_require_active_budget();

  select * into biz from public.businesses where id = p_business for update;
  if biz.id is null then raise exception 'Business not found'; end if;
  if biz.shares_available < qty then raise exception 'Not enough shares on market'; end if;

  cost := round(qty * biz.price_per_share, 2);
  insert into public.economy_wallets (user_id) values (v_uid) on conflict do nothing;
  select * into w from public.economy_wallets where user_id = v_uid for update;
  if w.balance < cost then raise exception 'Insufficient balance'; end if;

  new_bal := w.balance - cost;
  update public.economy_wallets set balance = new_bal, updated_at = now() where user_id = v_uid;

  new_premium := public._business_apply_trade_premium(biz.market_premium, qty, true);

  update public.businesses
  set shares_available = shares_available - qty,
      treasury = treasury + cost,
      market_premium = new_premium
  where id = p_business;

  insert into public.stock_holdings (user_id, business_id, shares) values (v_uid, p_business, qty)
  on conflict (user_id, business_id) do update set shares = stock_holdings.shares + excluded.shares;

  select shares into held from public.stock_holdings where user_id = v_uid and business_id = p_business;
  disclosed := held >= ceil(biz.total_shares * 0.05);

  new_price := public._business_refresh_share_price(p_business);

  insert into public.stock_trades (user_id, business_id, trade_type, shares, price_at_trade, total_value, is_disclosed)
  values (v_uid, p_business, 'buy', qty, biz.price_per_share, cost, disclosed);

  select b.id into pending_bill
  from public.bills b
  join public.bill_votes bv on bv.bill_id = b.id and bv.voter_id = v_uid
  where b.sector_tag = biz.sector
    and b.status not in ('law', 'vetoed', 'dead', 'rejected', 'expired', 'failed')
  limit 1;
  if pending_bill is not null then
    insert into public.corruption_ledger (actor_user_id, action_type, amount, metadata)
    values (v_uid, 'insider_trade', cost, jsonb_build_object('business_id', p_business, 'sector', biz.sector, 'bill_id', pending_bill, 'shares', qty));
  end if;

  return jsonb_build_object('ok', true, 'balance', new_bal, 'shares_held', held, 'price_per_share', new_price, 'market_premium', new_premium);
end;
$$;

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
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  perform public._economy_require_active_budget();

  select * into holding from public.stock_holdings where user_id = v_uid and business_id = p_business for update;
  if holding.shares is null or holding.shares < qty then raise exception 'Insufficient shares'; end if;

  select * into biz from public.businesses where id = p_business for update;
  proceeds := round(qty * biz.price_per_share, 2);
  if biz.treasury < proceeds then raise exception 'Business treasury cannot cover sale ($% available)', biz.treasury; end if;

  update public.stock_holdings set shares = shares - qty where user_id = v_uid and business_id = p_business;
  delete from public.stock_holdings where user_id = v_uid and business_id = p_business and shares = 0;

  new_premium := public._business_apply_trade_premium(biz.market_premium, qty, false);

  update public.businesses
  set shares_available = shares_available + qty,
      treasury = treasury - proceeds,
      market_premium = new_premium
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

create or replace function public.pay_dividend(p_business uuid, p_amount_per_share numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  biz record;
  per_share numeric := round(greatest(coalesce(p_amount_per_share, 0), 0), 4);
  total_cost numeric;
  h record;
  payout numeric;
  new_price numeric;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select * into biz from public.businesses where id = p_business for update;
  if biz.id is null then raise exception 'Business not found'; end if;
  if biz.owner_user_id <> v_uid then raise exception 'Only the owner may pay dividends'; end if;
  if per_share <= 0 then raise exception 'Dividend must be positive'; end if;

  total_cost := round(biz.total_shares * per_share, 2);
  if biz.treasury < total_cost then raise exception 'Insufficient business treasury'; end if;

  update public.businesses set treasury = treasury - total_cost where id = p_business;

  for h in select sh.user_id, sh.shares from public.stock_holdings sh where sh.business_id = p_business and sh.shares > 0 loop
    payout := round(h.shares * per_share, 2);
    if payout > 0 then
      insert into public.economy_wallets (user_id) values (h.user_id) on conflict do nothing;
      update public.economy_wallets set balance = balance + payout, updated_at = now() where user_id = h.user_id;
    end if;
  end loop;

  new_price := public._business_refresh_share_price(p_business);

  return jsonb_build_object('ok', true, 'total_paid', total_cost, 'price_per_share', new_price);
end;
$$;

create or replace function public.withdraw_business_earnings(p_business uuid, p_amount numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  amt numeric := round(greatest(coalesce(p_amount, 0), 0), 2);
  biz record;
  w record;
  new_bal numeric;
  new_price numeric;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select * into biz from public.businesses where id = p_business for update;
  if biz.id is null then raise exception 'Business not found'; end if;
  if biz.owner_user_id <> v_uid then raise exception 'Owner only'; end if;
  if amt <= 0 or biz.treasury < amt then raise exception 'Invalid withdrawal amount'; end if;

  update public.businesses set treasury = treasury - amt where id = p_business;
  new_price := public._business_refresh_share_price(p_business);

  insert into public.economy_wallets (user_id) values (v_uid) on conflict do nothing;
  select * into w from public.economy_wallets where user_id = v_uid for update;
  new_bal := w.balance + amt;
  update public.economy_wallets set balance = new_bal, updated_at = now() where user_id = v_uid;

  return jsonb_build_object('ok', true, 'balance', new_bal, 'withdrawn', amt, 'price_per_share', new_price);
end;
$$;

-- Backfill existing businesses
do $$
declare
  b_id uuid;
begin
  for b_id in select id from public.businesses loop
    perform public._business_refresh_share_price(b_id);
  end loop;
end $$;
