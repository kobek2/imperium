-- Player-owned businesses and stock exchange.

do $$ begin
  create type public.business_sector as enum ('defense', 'energy', 'finance', 'pharma', 'tech', 'media');
exception when duplicate_object then null;
end $$;

create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 3 and 80),
  sector public.business_sector not null,
  founding_capital numeric(20, 2) not null check (founding_capital > 0),
  total_shares integer not null default 10000 check (total_shares > 0),
  shares_available integer not null check (shares_available >= 0),
  price_per_share numeric(20, 4) not null check (price_per_share > 0),
  treasury numeric(20, 2) not null default 0 check (treasury >= 0),
  created_at timestamptz not null default now()
);

create index if not exists businesses_sector_idx on public.businesses (sector);
create index if not exists businesses_owner_idx on public.businesses (owner_user_id);

alter table public.businesses enable row level security;
drop policy if exists "businesses read authed" on public.businesses;
create policy "businesses read authed" on public.businesses for select to authenticated using (true);

create table if not exists public.stock_holdings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  shares integer not null default 0 check (shares >= 0),
  acquired_at timestamptz not null default now(),
  unique (user_id, business_id)
);

alter table public.stock_holdings enable row level security;
drop policy if exists "stock_holdings read own" on public.stock_holdings;
create policy "stock_holdings read own" on public.stock_holdings for select to authenticated
  using (user_id = auth.uid() or public.is_staff_economy_auditor(auth.uid()));

create table if not exists public.stock_trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  trade_type text not null check (trade_type in ('buy', 'sell')),
  shares integer not null check (shares > 0),
  price_at_trade numeric(20, 4) not null,
  total_value numeric(20, 2) not null,
  created_at timestamptz not null default now(),
  is_disclosed boolean not null default false
);

alter table public.stock_trades enable row level security;
drop policy if exists "stock_trades read authed" on public.stock_trades;
create policy "stock_trades read authed" on public.stock_trades for select to authenticated using (true);

create or replace view public.public_stock_disclosures as
select
  h.user_id,
  h.business_id,
  b.name as business_name,
  b.sector,
  h.shares,
  b.total_shares,
  round(100.0 * h.shares / b.total_shares, 2) as ownership_pct,
  b.price_per_share,
  (h.shares * b.price_per_share) as market_value
from public.stock_holdings h
join public.businesses b on b.id = h.business_id
where h.shares >= ceil(b.total_shares * 0.05);

grant select on public.public_stock_disclosures to authenticated;

-- ---------- Found a business ----------
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
  init_price numeric;
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
  init_price := cap / 10000.0;

  update public.economy_wallets set balance = new_bal, updated_at = now() where user_id = v_uid;

  insert into public.businesses (owner_user_id, name, sector, founding_capital, total_shares, shares_available, price_per_share, treasury)
  values (v_uid, trim(p_name), p_sector, cap, 10000, listed, init_price, 0)
  returning id into biz_id;

  insert into public.stock_holdings (user_id, business_id, shares) values (v_uid, biz_id, founder_shares);

  insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
  values (v_uid, -cap, new_bal, 'found_business', jsonb_build_object('business_id', biz_id, 'sector', p_sector));

  return jsonb_build_object('ok', true, 'business_id', biz_id, 'price_per_share', init_price, 'balance', new_bal);
end;
$$;

grant execute on function public.found_business(text, public.business_sector, numeric, integer) to authenticated;

-- ---------- Buy stock ----------
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
  new_held int;
  new_price numeric;
  disclosed boolean;
  pending_bill uuid;
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

  update public.businesses
  set shares_available = shares_available - qty,
      treasury = treasury + cost,
      price_per_share = greatest(0.01, price_per_share * (1 + 0.005 * (qty / 100.0)))
  where id = p_business
  returning price_per_share into new_price;

  insert into public.stock_holdings (user_id, business_id, shares) values (v_uid, p_business, qty)
  on conflict (user_id, business_id) do update set shares = stock_holdings.shares + excluded.shares;

  select shares into held from public.stock_holdings where user_id = v_uid and business_id = p_business;
  disclosed := held >= ceil(biz.total_shares * 0.05);

  insert into public.stock_trades (user_id, business_id, trade_type, shares, price_at_trade, total_value, is_disclosed)
  values (v_uid, p_business, 'buy', qty, biz.price_per_share, cost, disclosed);

  -- Insider trade flag if voter has pending bill vote conflict sector
  select b.id into pending_bill
  from public.bills b
  join public.bill_votes bv on bv.bill_id = b.id and bv.voter_id = v_uid
  where b.sector_tag = biz.sector and b.status not in ('enrolled', 'vetoed', 'failed')
  limit 1;
  if pending_bill is not null then
    insert into public.corruption_ledger (actor_user_id, action_type, amount, metadata)
    values (v_uid, 'insider_trade', cost, jsonb_build_object('business_id', p_business, 'sector', biz.sector, 'bill_id', pending_bill, 'shares', qty));
  end if;

  return jsonb_build_object('ok', true, 'balance', new_bal, 'shares_held', held, 'price_per_share', new_price);
end;
$$;

grant execute on function public.buy_stock(uuid, integer) to authenticated;

-- ---------- Sell stock ----------
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
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  perform public._economy_require_active_budget();

  select * into holding from public.stock_holdings where user_id = v_uid and business_id = p_business for update;
  if holding.shares is null or holding.shares < qty then raise exception 'Insufficient shares'; end if;

  select * into biz from public.businesses where id = p_business for update;
  proceeds := round(qty * biz.price_per_share, 2);

  if biz.treasury < proceeds then raise exception 'Business treasury cannot cover sale'; end if;

  update public.stock_holdings set shares = shares - qty where user_id = v_uid and business_id = p_business;
  delete from public.stock_holdings where user_id = v_uid and business_id = p_business and shares = 0;

  update public.businesses
  set shares_available = shares_available + qty,
      treasury = treasury - proceeds,
      price_per_share = greatest(0.01, price_per_share * (1 - 0.005 * (qty / 100.0)))
  where id = p_business
  returning price_per_share into new_price;

  insert into public.economy_wallets (user_id) values (v_uid) on conflict do nothing;
  select * into w from public.economy_wallets where user_id = v_uid for update;
  new_bal := w.balance + proceeds;
  update public.economy_wallets set balance = new_bal, updated_at = now() where user_id = v_uid;

  insert into public.stock_trades (user_id, business_id, trade_type, shares, price_at_trade, total_value, is_disclosed)
  values (v_uid, p_business, 'sell', qty, biz.price_per_share, proceeds, holding.shares >= ceil(biz.total_shares * 0.05));

  return jsonb_build_object('ok', true, 'balance', new_bal, 'proceeds', proceeds, 'price_per_share', new_price);
end;
$$;

grant execute on function public.sell_stock(uuid, integer) to authenticated;

-- ---------- Pay dividend ----------
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
  new_bal numeric;
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
    new_bal := round(h.shares * per_share, 2);
    if new_bal > 0 then
      insert into public.economy_wallets (user_id) values (h.user_id) on conflict do nothing;
      update public.economy_wallets set balance = balance + new_bal, updated_at = now() where user_id = h.user_id;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'total_paid', total_cost);
end;
$$;

grant execute on function public.pay_dividend(uuid, numeric) to authenticated;

-- ---------- Withdraw business earnings ----------
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
  shares_to_sell int;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select * into biz from public.businesses where id = p_business for update;
  if biz.id is null then raise exception 'Business not found'; end if;
  if biz.owner_user_id <> v_uid then raise exception 'Owner only'; end if;
  if amt <= 0 or biz.treasury < amt then raise exception 'Invalid withdrawal amount'; end if;

  shares_to_sell := ceil(amt / biz.price_per_share);
  perform public.sell_stock(p_business, least(shares_to_sell, (select shares from public.stock_holdings where user_id = v_uid and business_id = p_business)));

  update public.businesses set treasury = treasury - amt where id = p_business;
  insert into public.economy_wallets (user_id) values (v_uid) on conflict do nothing;
  select * into w from public.economy_wallets where user_id = v_uid for update;
  new_bal := w.balance + amt;
  update public.economy_wallets set balance = new_bal, updated_at = now() where user_id = v_uid;

  return jsonb_build_object('ok', true, 'balance', new_bal, 'withdrawn', amt);
end;
$$;

grant execute on function public.withdraw_business_earnings(uuid, numeric) to authenticated;
