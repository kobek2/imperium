-- Sector market share: company revenue, growth, and sector dominance tracking.

alter table public.simulation_settings
  add column if not exists last_sector_market_tick_at timestamptz;

alter table public.businesses
  add column if not exists revenue numeric(20, 2) not null default 0 check (revenue >= 0),
  add column if not exists growth_rate numeric(8, 6) not null default 0 check (growth_rate >= 0),
  add column if not exists market_share numeric(8, 5) not null default 0
    check (market_share >= 0 and market_share <= 100);

create table if not exists public.sector_market_stats (
  id uuid primary key default gen_random_uuid(),
  sector public.business_sector not null unique,
  total_sector_revenue numeric(20, 2) not null default 0 check (total_sector_revenue >= 0),
  largest_company_id uuid references public.businesses (id) on delete set null,
  market_concentration numeric(8, 5) not null default 0
    check (market_concentration >= 0 and market_concentration <= 100),
  updated_at timestamptz not null default now()
);

alter table public.sector_market_stats enable row level security;
drop policy if exists "sector_market_stats read authed" on public.sector_market_stats;
create policy "sector_market_stats read authed"
  on public.sector_market_stats for select to authenticated using (true);

-- Strategy → base hourly growth rate (decimal, e.g. 0.10 = 10% per sim-hour).
create or replace function public._company_strategy_growth_rate(p_strategy public.company_strategy)
returns numeric
language sql
immutable
as $$
  select case coalesce(p_strategy::text, 'stable')
    when 'growth' then 0.10
    when 'market_expansion' then 0.06
    else 0.03
  end;
$$;

-- IPO starting revenue: fraction of valuation at incorporation.
create or replace function public._company_initial_revenue(p_valuation numeric)
returns numeric
language sql
immutable
as $$
  select round(greatest(coalesce(p_valuation, 0) * 0.5, 1000000), 2);
$$;

-- Effective growth for one tick (market_expansion gets a competitive bonus).
create or replace function public._company_effective_growth_rate(
  p_strategy public.company_strategy,
  p_base_rate numeric
)
returns numeric
language sql
immutable
as $$
  select coalesce(p_base_rate, public._company_strategy_growth_rate(p_strategy))
    * case when coalesce(p_strategy::text, 'stable') = 'market_expansion' then 1.15 else 1.0 end;
$$;

create or replace function public._recalc_sector_market_share(p_sector public.business_sector)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total numeric;
  v_largest_id uuid;
  v_concentration numeric;
begin
  select coalesce(sum(revenue), 0) into v_total
  from public.businesses
  where sector = p_sector and revenue > 0;

  if v_total <= 0 then
    update public.businesses set market_share = 0 where sector = p_sector;
    insert into public.sector_market_stats (sector, total_sector_revenue, largest_company_id, market_concentration, updated_at)
    values (p_sector, 0, null, 0, now())
    on conflict (sector) do update set
      total_sector_revenue = 0,
      largest_company_id = null,
      market_concentration = 0,
      updated_at = now();
    return;
  end if;

  update public.businesses b
  set market_share = round((b.revenue / v_total) * 100, 2)
  where b.sector = p_sector;

  select b.id, b.market_share
  into v_largest_id, v_concentration
  from public.businesses b
  where b.sector = p_sector
  order by b.revenue desc, b.created_at asc
  limit 1;

  insert into public.sector_market_stats (sector, total_sector_revenue, largest_company_id, market_concentration, updated_at)
  values (p_sector, v_total, v_largest_id, coalesce(v_concentration, 0), now())
  on conflict (sector) do update set
    total_sector_revenue = excluded.total_sector_revenue,
    largest_company_id = excluded.largest_company_id,
    market_concentration = excluded.market_concentration,
    updated_at = now();
end;
$$;

create or replace function public._recalc_all_sector_market_shares()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.business_sector;
begin
  for s in select unnest(enum_range(null::public.business_sector)) loop
    perform public._recalc_sector_market_share(s);
  end loop;
end;
$$;

create or replace function public._tick_all_company_revenue(p_hours int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_rate numeric;
  v_new_revenue numeric;
  h int := greatest(coalesce(p_hours, 0), 0);
begin
  if h < 1 then return; end if;

  for r in
    select id, revenue, growth_rate, strategy
    from public.businesses
    where revenue > 0
    for update
  loop
    v_rate := public._company_effective_growth_rate(r.strategy, r.growth_rate);
    v_new_revenue := round(r.revenue * power(1 + v_rate, h), 2);
    update public.businesses set revenue = v_new_revenue where id = r.id;
  end loop;

  perform public._recalc_all_sector_market_shares();
end;
$$;

-- Global sector tick (at most once per sim-hour, triggered from economy_collect_income).
create or replace function public._maybe_tick_sector_markets()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  last_tick timestamptz;
  v_hours int;
begin
  select s.last_sector_market_tick_at into last_tick
  from public.simulation_settings s
  where s.id = 1
  for update;

  v_hours := floor(extract(epoch from (now() - coalesce(last_tick, '1970-01-01'::timestamptz))) / 3600)::int;
  if v_hours < 1 then return; end if;

  perform public._tick_all_company_revenue(v_hours);

  update public.simulation_settings
  set last_sector_market_tick_at = now()
  where id = 1;
end;
$$;

-- Rank within sector by revenue (1 = largest).
create or replace function public.company_sector_rank(p_company_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  with target as (
    select sector, revenue, created_at from public.businesses where id = p_company_id
  )
  select coalesce((
    select count(*)::int + 1
    from public.businesses b
    join target t on b.sector = t.sector
    where b.revenue > t.revenue
       or (b.revenue = t.revenue and b.created_at < t.created_at)
  ), 1);
$$;

-- IPO: seed revenue/growth and recalc sector shares.
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
  v_strategy public.company_strategy := coalesce(p_strategy, 'stable'::public.company_strategy);
  v_revenue numeric;
  v_growth numeric;
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
  v_revenue := public._company_initial_revenue(valuation);
  v_growth := public._company_strategy_growth_rate(v_strategy);

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
    public_shares, founder_shares, ipo_date, revenue, growth_rate
  ) values (
    v_uid, v_name, p_sector, nominal_founding_fee, total_sh, public_sh, initial_price, 0, 1.0,
    v_ticker,
    nullif(trim(coalesce(p_description, '')), ''),
    nullif(trim(coalesce(p_primary_focus, '')), ''),
    v_strategy,
    valuation, public_sh, founder_sh, now(),
    v_revenue, v_growth
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
      'dev_free', wallet_charge = 0,
      'initial_revenue', v_revenue,
      'growth_rate', v_growth
    )
  );

  perform public._recalc_sector_market_share(p_sector);

  return jsonb_build_object(
    'ok', true,
    'business_id', biz_id,
    'ticker_symbol', v_ticker,
    'price_per_share', initial_price,
    'valuation', valuation,
    'balance', new_bal,
    'revenue', v_revenue,
    'growth_rate', v_growth
  );
end;
$$;

-- Backfill existing companies.
update public.businesses b
set
  revenue = case when b.revenue <= 0 then public._company_initial_revenue(coalesce(b.valuation, b.founding_capital)) else b.revenue end,
  growth_rate = case when b.growth_rate <= 0 then public._company_strategy_growth_rate(b.strategy) else b.growth_rate end
where b.revenue <= 0 or b.growth_rate <= 0;

select public._recalc_all_sector_market_shares();

-- Seed sector_market_stats rows for every sector enum value.
insert into public.sector_market_stats (sector, total_sector_revenue, market_concentration, updated_at)
select s.sector, 0, 0, now()
from (select unnest(enum_range(null::public.business_sector)) as sector) s
on conflict (sector) do nothing;

select public._recalc_all_sector_market_shares();

-- Hook global sector tick into economy income collection.
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
    perform public._maybe_tick_sector_markets();
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

  perform public._maybe_tick_sector_markets();

  return jsonb_build_object(
    'ok', true, 'hours', v_hours, 'paid', v_after_levy, 'balance', w.balance + v_after_levy,
    'party_levy', v_levy, 'role_hourly', v_role_hourly, 'pac_hourly', 0,
    'gross_collect', v_salary_collect, 'party_levy_salary_base', v_salary_collect
  );
end;
$$;

grant execute on function public.company_sector_rank(uuid) to authenticated;

notify pgrst, 'reload schema';
