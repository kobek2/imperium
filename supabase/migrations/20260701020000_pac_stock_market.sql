-- PAC stock market: external investors buy/sell PAC equity; capital flows into PAC treasury and lifts valuation.

alter table public.pac_organizations
  add column if not exists shares_outstanding numeric(20, 4) not null default 10000 check (shares_outstanding > 0),
  add column if not exists float_shares_available numeric(20, 4) not null default 4000 check (float_shares_available >= 0),
  add column if not exists share_price numeric(20, 4) not null default 1000 check (share_price > 0);

update public.pac_organizations
set
  shares_outstanding = coalesce(shares_outstanding, 10000),
  float_shares_available = coalesce(float_shares_available, 4000),
  share_price = coalesce(share_price, 1000)
where shares_outstanding is null
   or float_shares_available is null
   or share_price is null;

create table if not exists public.pac_investor_holdings (
  investor_user_id uuid not null references public.profiles (id) on delete cascade,
  pac_id uuid not null references public.pac_organizations (id) on delete cascade,
  shares numeric(20, 4) not null default 0 check (shares > 0),
  avg_cost numeric(20, 4) not null default 0 check (avg_cost >= 0),
  primary key (investor_user_id, pac_id)
);

create index if not exists pac_investor_holdings_pac_idx on public.pac_investor_holdings (pac_id);

alter table public.pac_investor_holdings enable row level security;
drop policy if exists "pac_investor_holdings read authed" on public.pac_investor_holdings;
create policy "pac_investor_holdings read authed" on public.pac_investor_holdings
  for select to authenticated using (true);

-- Industry book value inside a PAC portfolio
create or replace function public._pac_industry_book_value(p_pac_id uuid)
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(sum(ph.shares * s.current_price), 0)::numeric
  from public.pac_holdings ph
  join public.industry_sectors s on s.key = ph.industry_key
  where ph.pac_id = p_pac_id;
$$;

-- Mark-to-market valuation and per-share price
create or replace function public._pac_market_valuation(p_pac_id uuid)
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  select
    coalesce(po.treasury_balance, 0)
    + public._pac_industry_book_value(p_pac_id)
    + (po.tier * 250000)::numeric
  from public.pac_organizations po
  where po.id = p_pac_id;
$$;

create or replace function public._pac_refresh_share_price(p_pac_id uuid)
returns numeric
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_shares numeric;
  v_valuation numeric;
  v_price numeric;
begin
  select shares_outstanding into v_shares
  from public.pac_organizations
  where id = p_pac_id
  for update;

  if v_shares is null then
    return 0;
  end if;

  v_valuation := public._pac_market_valuation(p_pac_id);
  v_price := greatest(100::numeric, round(v_valuation / v_shares, 2));

  update public.pac_organizations
  set share_price = v_price, updated_at = now()
  where id = p_pac_id;

  return v_price;
end;
$$;

-- Initialize share price for existing PACs
do $$
declare
  pac_id uuid;
begin
  for pac_id in select id from public.pac_organizations loop
    perform public._pac_refresh_share_price(pac_id);
  end loop;
end $$;

create or replace function public.pac_market_buy(p_pac_id uuid, p_shares numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  qty numeric := round(p_shares, 4);
  pac_row record;
  w record;
  price numeric;
  cost numeric;
  new_bal numeric;
  new_treasury numeric;
  holding record;
  new_shares numeric;
  new_avg numeric;
  new_float numeric;
  new_price numeric;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  perform public._economy_require_active_budget();
  if qty is null or qty <= 0 then raise exception 'Invalid share quantity'; end if;
  if qty > 10000 then raise exception 'Maximum 10,000 shares per order'; end if;

  select * into pac_row from public.pac_organizations where id = p_pac_id for update;
  if pac_row.id is null then raise exception 'PAC not found'; end if;
  if pac_row.owner_user_id = v_uid then
    raise exception 'Use your PAC treasury deposit to fund your own PAC — the market is for outside investors';
  end if;
  if qty > pac_row.float_shares_available then
    raise exception 'Only % shares available on the public float', pac_row.float_shares_available;
  end if;

  price := pac_row.share_price;
  cost := round(qty * price, 2);
  if cost < 100 then raise exception 'Minimum order value is $100'; end if;

  insert into public.economy_wallets (user_id) values (v_uid) on conflict do nothing;
  select * into w from public.economy_wallets where user_id = v_uid for update;
  if w.balance < cost then raise exception 'Insufficient balance'; end if;

  new_bal := w.balance - cost;
  new_treasury := pac_row.treasury_balance + cost;
  new_float := pac_row.float_shares_available - qty;

  update public.economy_wallets set balance = new_bal, updated_at = now() where user_id = v_uid;
  update public.pac_organizations
  set treasury_balance = new_treasury,
      float_shares_available = new_float,
      updated_at = now()
  where id = p_pac_id;

  select * into holding
  from public.pac_investor_holdings
  where investor_user_id = v_uid and pac_id = p_pac_id
  for update;

  if holding.investor_user_id is null then
    insert into public.pac_investor_holdings (investor_user_id, pac_id, shares, avg_cost)
    values (v_uid, p_pac_id, qty, price);
  else
    new_shares := holding.shares + qty;
    new_avg := round(((holding.shares * holding.avg_cost) + (qty * price)) / new_shares, 4);
    update public.pac_investor_holdings
    set shares = new_shares, avg_cost = new_avg
    where investor_user_id = v_uid and pac_id = p_pac_id;
  end if;

  insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
  values (
    v_uid, -cost, new_bal, 'pac_market_buy',
    jsonb_build_object('pac_id', p_pac_id, 'shares', qty, 'price', price, 'cost', cost)
  );

  new_price := public._pac_refresh_share_price(p_pac_id);

  return jsonb_build_object(
    'ok', true,
    'cost', cost,
    'share_price', new_price,
    'shares', qty,
    'balance', new_bal,
    'pac_treasury', new_treasury
  );
end;
$$;

grant execute on function public.pac_market_buy(uuid, numeric) to authenticated;

create or replace function public.pac_market_sell(p_pac_id uuid, p_shares numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  qty numeric := round(p_shares, 4);
  pac_row record;
  w record;
  holding record;
  price numeric;
  proceeds numeric;
  new_bal numeric;
  new_treasury numeric;
  new_shares numeric;
  new_float numeric;
  new_price numeric;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  perform public._economy_require_active_budget();
  if qty is null or qty <= 0 then raise exception 'Invalid share quantity'; end if;

  select * into holding
  from public.pac_investor_holdings
  where investor_user_id = v_uid and pac_id = p_pac_id
  for update;

  if holding.investor_user_id is null or holding.shares < qty then
    raise exception 'Insufficient PAC shares to sell';
  end if;

  select * into pac_row from public.pac_organizations where id = p_pac_id for update;
  if pac_row.id is null then raise exception 'PAC not found'; end if;

  price := pac_row.share_price;
  proceeds := round(qty * price, 2);

  if pac_row.treasury_balance < proceeds then
    raise exception 'PAC treasury cannot cover this redemption right now';
  end if;

  insert into public.economy_wallets (user_id) values (v_uid) on conflict do nothing;
  select * into w from public.economy_wallets where user_id = v_uid for update;

  new_bal := w.balance + proceeds;
  new_treasury := pac_row.treasury_balance - proceeds;
  new_float := pac_row.float_shares_available + qty;

  update public.economy_wallets set balance = new_bal, updated_at = now() where user_id = v_uid;
  update public.pac_organizations
  set treasury_balance = new_treasury,
      float_shares_available = new_float,
      updated_at = now()
  where id = p_pac_id;

  new_shares := holding.shares - qty;
  if new_shares <= 0 then
    delete from public.pac_investor_holdings where investor_user_id = v_uid and pac_id = p_pac_id;
  else
    update public.pac_investor_holdings set shares = new_shares where investor_user_id = v_uid and pac_id = p_pac_id;
  end if;

  insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
  values (
    v_uid, proceeds, new_bal, 'pac_market_sell',
    jsonb_build_object('pac_id', p_pac_id, 'shares', qty, 'price', price, 'proceeds', proceeds)
  );

  new_price := public._pac_refresh_share_price(p_pac_id);

  return jsonb_build_object(
    'ok', true,
    'proceeds', proceeds,
    'share_price', new_price,
    'shares', qty,
    'balance', new_bal
  );
end;
$$;

grant execute on function public.pac_market_sell(uuid, numeric) to authenticated;

create or replace function public.pac_list_market()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return coalesce(
    (
      select jsonb_agg(row order by (row->>'valuation')::numeric desc)
      from (
        select jsonb_build_object(
          'pac_id', po.id,
          'name', po.name,
          'owner_user_id', po.owner_user_id,
          'tier', po.tier,
          'treasury_balance', po.treasury_balance,
          'share_price', po.share_price,
          'valuation', public._pac_market_valuation(po.id),
          'float_shares_available', po.float_shares_available,
          'shares_outstanding', po.shares_outstanding,
          'revenue_hourly', po.revenue_hourly,
          'exposure_risk', po.exposure_risk,
          'investor_count', (
            select count(*)::int from public.pac_investor_holdings h where h.pac_id = po.id
          )
        ) as row
        from public.pac_organizations po
        order by public._pac_market_valuation(po.id) desc
      ) sub
    ),
    '[]'::jsonb
  );
end;
$$;

grant execute on function public.pac_list_market() to authenticated;

create or replace function public.pac_my_investments()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  return coalesce(
    (
      select jsonb_agg(jsonb_build_object(
        'pac_id', h.pac_id,
        'pac_name', po.name,
        'owner_user_id', po.owner_user_id,
        'shares', h.shares,
        'avg_cost', h.avg_cost,
        'share_price', po.share_price,
        'market_value', round(h.shares * po.share_price, 2),
        'gain_loss', round((h.shares * po.share_price) - (h.shares * h.avg_cost), 2)
      ) order by h.shares * po.share_price desc)
      from public.pac_investor_holdings h
      join public.pac_organizations po on po.id = h.pac_id
      where h.investor_user_id = v_uid
    ),
    '[]'::jsonb
  );
end;
$$;

grant execute on function public.pac_my_investments() to authenticated;

-- Enriched owner status includes market fields
create or replace function public.pac_my_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  pac_row record;
  holdings jsonb;
  v_valuation numeric;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  select * into pac_row from public.pac_organizations where owner_user_id = v_uid;

  if pac_row.id is null then
    return jsonb_build_object('has_pac', false);
  end if;

  v_valuation := public._pac_market_valuation(pac_row.id);

  select coalesce(jsonb_agg(jsonb_build_object(
    'industry_key', ph.industry_key,
    'shares', ph.shares,
    'avg_cost', ph.avg_cost
  )), '[]'::jsonb) into holdings
  from public.pac_holdings ph
  where ph.pac_id = pac_row.id;

  return jsonb_build_object(
    'has_pac', true,
    'pac_id', pac_row.id,
    'name', pac_row.name,
    'tier', pac_row.tier,
    'treasury_balance', pac_row.treasury_balance,
    'treasury_cap', public._pac_tier_treasury_cap(pac_row.tier),
    'legal_cap_per_candidate', public._pac_tier_legal_cap(pac_row.tier),
    'revenue_hourly', pac_row.revenue_hourly,
    'exposure_risk', pac_row.exposure_risk,
    'share_price', pac_row.share_price,
    'valuation', v_valuation,
    'shares_outstanding', pac_row.shares_outstanding,
    'float_shares_available', pac_row.float_shares_available,
    'holdings', holdings
  );
end;
$$;

-- Refresh share price after treasury-affecting PAC ops
create or replace function public.economy_buy_pac(p_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  price numeric := 5000000;
  v_name text := trim(coalesce(p_name, ''));
  w record;
  new_bal numeric;
  pac_id uuid;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  perform public._economy_require_active_budget();

  if v_name = '' or char_length(v_name) < 3 then
    raise exception 'PAC name must be at least 3 characters';
  end if;

  if exists (select 1 from public.pac_organizations where owner_user_id = v_uid) then
    raise exception 'PAC already registered';
  end if;

  insert into public.economy_wallets (user_id) values (v_uid) on conflict do nothing;
  select * into w from public.economy_wallets where user_id = v_uid for update;
  if w.balance < price then raise exception 'Insufficient balance'; end if;

  new_bal := w.balance - price;
  update public.economy_wallets set balance = new_bal, updated_at = now() where user_id = v_uid;

  insert into public.pac_organizations (
    owner_user_id, name, tier, treasury_balance, revenue_hourly,
    shares_outstanding, float_shares_available, share_price
  ) values (
    v_uid, v_name, 1, 1000000, public._pac_tier_revenue_hourly(1),
    10000, 4000, 1000
  ) returning id into pac_id;

  perform public._pac_refresh_share_price(pac_id);

  insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
  values (v_uid, -price, new_bal, 'pac_purchase', jsonb_build_object('tier', 1, 'pac_id', pac_id, 'name', v_name));

  return jsonb_build_object('ok', true, 'balance', new_bal, 'pac_tier', 1, 'pac_id', pac_id);
end;
$$;

notify pgrst, 'reload schema';
