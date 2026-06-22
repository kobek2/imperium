-- Public company IPO foundation: tickers, profiles, strategies, trade history.

alter type public.business_sector add value if not exists 'healthcare';
alter type public.business_sector add value if not exists 'real_estate';
alter type public.business_sector add value if not exists 'agriculture';

do $$ begin
  create type public.company_strategy as enum ('growth', 'stable', 'market_expansion');
exception when duplicate_object then null;
end $$;

-- Extend businesses
alter table public.businesses
  add column if not exists ticker_symbol text,
  add column if not exists description text,
  add column if not exists primary_focus text,
  add column if not exists strategy public.company_strategy,
  add column if not exists valuation numeric(20, 2),
  add column if not exists public_shares integer,
  add column if not exists founder_shares integer,
  add column if not exists ipo_date timestamptz;

create unique index if not exists businesses_ticker_symbol_idx
  on public.businesses (upper(ticker_symbol))
  where ticker_symbol is not null;

alter table public.businesses
  drop constraint if exists businesses_ticker_format_chk;
alter table public.businesses
  add constraint businesses_ticker_format_chk
  check (
    ticker_symbol is null
    or (ticker_symbol ~ '^[A-Z]{3,5}$')
  );

-- Public trade ledger (buyer/seller explicit)
create table if not exists public.stock_trade_history (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.businesses (id) on delete cascade,
  buyer_id uuid references public.profiles (id) on delete set null,
  seller_id uuid references public.profiles (id) on delete set null,
  trade_type text not null check (trade_type in ('buy', 'sell')),
  shares integer not null check (shares > 0),
  price_per_share numeric(20, 4) not null check (price_per_share > 0),
  total_value numeric(20, 2) not null check (total_value > 0),
  created_at timestamptz not null default now()
);

create index if not exists stock_trade_history_company_time_idx
  on public.stock_trade_history (company_id, created_at desc);
create index if not exists stock_trade_history_buyer_idx
  on public.stock_trade_history (buyer_id, created_at desc);
create index if not exists stock_trade_history_seller_idx
  on public.stock_trade_history (seller_id, created_at desc);

alter table public.stock_trade_history enable row level security;
drop policy if exists "stock_trade_history read authed" on public.stock_trade_history;
create policy "stock_trade_history read authed"
  on public.stock_trade_history for select to authenticated using (true);

-- Strategy → trade volatility multiplier
create or replace function public._company_strategy_premium_step(p_strategy public.company_strategy, p_shares int, p_is_buy boolean)
returns numeric
language sql
immutable
as $$
  select
    (case when p_is_buy then 1 else -1 end)
    * (case coalesce(p_strategy::text, 'stable')
        when 'growth' then 0.008
        when 'market_expansion' then 0.006
        else 0.003
      end)
    * (greatest(coalesce(p_shares, 0), 0)::numeric / 100.0);
$$;

create or replace function public._business_base_share_price(p_valuation numeric, p_total_shares int)
returns numeric
language sql
immutable
as $$
  select greatest(0.0001, coalesce(p_valuation, 0) / greatest(coalesce(p_total_shares, 1), 1)::numeric);
$$;

create or replace function public._business_refresh_share_price(p_business_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  biz record;
  base numeric;
  new_price numeric;
begin
  select * into biz from public.businesses where id = p_business_id for update;
  if biz.id is null then return 0; end if;

  if biz.valuation is not null and biz.valuation > 0 then
    base := public._business_base_share_price(biz.valuation, biz.total_shares);
  else
    base := public._business_book_per_share(biz.treasury, biz.founding_capital, biz.total_shares);
  end if;

  new_price := round(base * coalesce(biz.market_premium, 1.0), 4);

  update public.businesses set price_per_share = new_price where id = p_business_id;
  perform public._business_record_price_history(p_business_id, new_price);

  return new_price;
end;
$$;

create or replace function public._business_apply_trade_premium(
  p_premium numeric,
  p_shares int,
  p_is_buy boolean,
  p_strategy public.company_strategy default 'stable'
)
returns numeric
language sql
immutable
as $$
  select least(
    4.0,
    greatest(
      0.25,
      coalesce(p_premium, 1.0) + public._company_strategy_premium_step(p_strategy, p_shares, p_is_buy)
    )
  );
$$;

-- Ticker helpers
create or replace function public._normalize_ticker(p_raw text)
returns text
language sql
immutable
as $$
  select upper(regexp_replace(coalesce(p_raw, ''), '[^A-Z]', '', 'g'));
$$;

create or replace function public.suggest_company_ticker(p_name text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  words text[];
  w text;
  base text := '';
  candidate text;
  suffix int := 0;
begin
  words := regexp_split_to_array(lower(trim(coalesce(p_name, ''))), '\s+');

  for w in select unnest(words) loop
    if length(w) > 0 then
      base := base || upper(substr(w, 1, 1));
    end if;
    exit when length(base) >= 5;
  end loop;

  if length(base) < 3 then
    base := upper(regexp_replace(substr(coalesce(p_name, 'CO'), 1, 5), '[^A-Z]', '', 'g'));
  end if;

  base := substr(base, 1, 5);
  while length(base) < 3 loop
    base := base || 'X';
  end loop;

  candidate := base;
  while exists (
    select 1 from public.businesses b where upper(b.ticker_symbol) = candidate
  ) loop
    suffix := suffix + 1;
    candidate := substr(base, 1, greatest(3, 5 - length(suffix::text))) || suffix::text;
    if length(candidate) > 5 then
      candidate := substr(base, 1, 2) || lpad(suffix::text, 3, '0');
      candidate := substr(candidate, 1, 5);
    end if;
  end loop;

  return candidate;
end;
$$;

grant execute on function public.suggest_company_ticker(text) to authenticated;

create or replace function public.check_ticker_available(p_ticker text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1 from public.businesses b
    where upper(b.ticker_symbol) = public._normalize_ticker(p_ticker)
  );
$$;

grant execute on function public.check_ticker_available(text) to authenticated;

-- IPO: $10M founding fee + issue shares
create or replace function public.found_public_company(
  p_name text,
  p_description text,
  p_primary_focus text,
  p_sector public.business_sector,
  p_strategy public.company_strategy,
  p_ticker text,
  p_valuation numeric,
  p_total_shares integer,
  p_public_shares integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  nominal_founding_fee numeric := 10000000;
  wallet_charge numeric;
  v_name text := trim(coalesce(p_name, ''));
  v_ticker text;
  valuation numeric := round(greatest(coalesce(p_valuation, 0), 0), 2);
  total_sh int := greatest(coalesce(p_total_shares, 0), 0);
  public_sh int := greatest(coalesce(p_public_shares, 0), 0);
  founder_sh int;
  w record;
  new_bal numeric;
  biz_id uuid;
  initial_price numeric;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  perform public._economy_require_active_budget();

  if char_length(v_name) < 3 then raise exception 'Company name must be at least 3 characters'; end if;
  if valuation < 1000000 then raise exception 'Minimum company valuation is $1,000,000'; end if;
  if total_sh < 1000 then raise exception 'Minimum total shares is 1,000'; end if;
  if public_sh < 1 or public_sh >= total_sh then raise exception 'Public shares must be between 1 and total shares minus 1'; end if;

  founder_sh := total_sh - public_sh;
  if founder_sh <= total_sh / 2 then raise exception 'Founder must retain majority ownership (>50%%)'; end if;

  v_ticker := public._normalize_ticker(p_ticker);
  if v_ticker = '' or length(v_ticker) < 3 or length(v_ticker) > 5 then
    v_ticker := public.suggest_company_ticker(v_name);
  end if;
  if v_ticker !~ '^[A-Z]{3,5}$' then raise exception 'Ticker must be 3-5 uppercase letters'; end if;
  if exists (select 1 from public.businesses where upper(ticker_symbol) = v_ticker) then
    raise exception 'Ticker % is already taken', v_ticker;
  end if;

  wallet_charge := case when public._economy_dev_mode_enabled() then 0::numeric else nominal_founding_fee end;

  insert into public.economy_wallets (user_id) values (v_uid) on conflict do nothing;
  select * into w from public.economy_wallets where user_id = v_uid for update;
  if wallet_charge > 0 and w.balance < wallet_charge then
    raise exception 'Insufficient balance — $10,000,000 founding fee required';
  end if;

  new_bal := w.balance - wallet_charge;
  update public.economy_wallets set balance = new_bal, updated_at = now() where user_id = v_uid;

  initial_price := round(valuation / total_sh, 4);

  insert into public.businesses (
    owner_user_id, name, sector, founding_capital, total_shares, shares_available,
    price_per_share, treasury, market_premium,
    ticker_symbol, description, primary_focus, strategy, valuation,
    public_shares, founder_shares, ipo_date
  ) values (
    v_uid, v_name, p_sector, nominal_founding_fee, total_sh, public_sh, initial_price, 0, 1.0,
    v_ticker,
    nullif(trim(coalesce(p_description, '')), ''),
    nullif(trim(coalesce(p_primary_focus, '')), ''),
    coalesce(p_strategy, 'stable'::public.company_strategy),
    valuation, public_sh, founder_sh, now()
  ) returning id into biz_id;

  insert into public.stock_holdings (user_id, business_id, shares)
  values (v_uid, biz_id, founder_sh);

  insert into public.business_price_history (business_id, price_per_share, recorded_at)
  values (biz_id, initial_price, now());

  insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
  values (
    v_uid, -wallet_charge, new_bal, 'found_business',
    jsonb_build_object(
      'business_id', biz_id,
      'ticker', v_ticker,
      'valuation', valuation,
      'total_shares', total_sh,
      'public_shares', public_sh,
      'ipo_price', initial_price,
      'dev_free', wallet_charge = 0
    )
  );

  return jsonb_build_object(
    'ok', true,
    'business_id', biz_id,
    'ticker_symbol', v_ticker,
    'price_per_share', initial_price,
    'valuation', valuation,
    'balance', new_bal
  );
end;
$$;

grant execute on function public.found_public_company(
  text, text, text, public.business_sector, public.company_strategy, text, numeric, integer, integer
) to authenticated;

-- Back-compat wrapper
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
  listed int := greatest(0, coalesce(p_shares_listed, 0));
  total int := 10000;
  valuation numeric := greatest(coalesce(p_capital, 20000000), 1000000);
begin
  return public.found_public_company(
    p_name,
    null,
    'Legacy incorporation',
    p_sector,
    'stable'::public.company_strategy,
    public.suggest_company_ticker(p_name),
    valuation,
    total,
    listed
  );
end;
$$;

create or replace function public._record_stock_trade_history(
  p_company uuid,
  p_buyer uuid,
  p_seller uuid,
  p_type text,
  p_shares int,
  p_price numeric,
  p_total numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.stock_trade_history (
    company_id, buyer_id, seller_id, trade_type, shares, price_per_share, total_value
  ) values (p_company, p_buyer, p_seller, p_type, p_shares, p_price, p_total);
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

  new_premium := public._business_apply_trade_premium(biz.market_premium, qty, true, biz.strategy);

  update public.businesses
  set shares_available = shares_available - qty,
      treasury = treasury + cost,
      market_premium = new_premium
  where id = p_business;

  insert into public.stock_holdings (user_id, business_id, shares) values (v_uid, p_business, qty)
  on conflict (user_id, business_id) do update set shares = stock_holdings.shares + excluded.shares;

  select shares into held from public.stock_holdings where user_id = v_uid and business_id = p_business;

  new_price := public._business_refresh_share_price(p_business);

  insert into public.stock_trades (user_id, business_id, trade_type, shares, price_at_trade, total_value, is_disclosed)
  values (v_uid, p_business, 'buy', qty, biz.price_per_share, cost, held >= ceil(biz.total_shares * 0.05));

  perform public._record_stock_trade_history(
    p_business, v_uid, null, 'buy', qty, biz.price_per_share, cost
  );

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

  new_premium := public._business_apply_trade_premium(biz.market_premium, qty, false, biz.strategy);

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

  perform public._record_stock_trade_history(
    p_business, null, v_uid, 'sell', qty, biz.price_per_share, proceeds
  );

  return jsonb_build_object('ok', true, 'balance', new_bal, 'proceeds', proceeds, 'price_per_share', new_price, 'market_premium', new_premium);
end;
$$;

-- Backfill legacy companies (one ticker at a time to avoid unique collisions)
do $$
declare
  r record;
begin
  for r in select id, name from public.businesses where ticker_symbol is null order by created_at loop
    update public.businesses
    set ticker_symbol = public.suggest_company_ticker(r.name)
    where id = r.id;
  end loop;
end;
$$;

update public.businesses
set
  valuation = coalesce(valuation, price_per_share * total_shares),
  public_shares = coalesce(public_shares, shares_available),
  founder_shares = coalesce(founder_shares, greatest(total_shares - shares_available, 0)),
  strategy = coalesce(strategy, 'stable'::public.company_strategy),
  ipo_date = coalesce(ipo_date, created_at),
  description = coalesce(description, 'Incorporated before public IPO records.'),
  primary_focus = coalesce(primary_focus, initcap(replace(sector::text, '_', ' ')))
where valuation is null or description is null;

-- Migrate legacy stock_trades into stock_trade_history where missing
insert into public.stock_trade_history (company_id, buyer_id, seller_id, trade_type, shares, price_per_share, total_value, created_at)
select
  t.business_id,
  case when t.trade_type = 'buy' then t.user_id else null end,
  case when t.trade_type = 'sell' then t.user_id else null end,
  t.trade_type,
  t.shares,
  t.price_at_trade,
  t.total_value,
  t.created_at
from public.stock_trades t
where not exists (
  select 1 from public.stock_trade_history h
  where h.company_id = t.business_id
    and h.created_at = t.created_at
    and h.shares = t.shares
    and h.trade_type = t.trade_type
);

notify pgrst, 'reload schema';
