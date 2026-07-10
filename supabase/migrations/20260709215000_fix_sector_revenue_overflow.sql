-- Fix numeric(20,2) overflow on income collect: sector revenue ticks compounded without hour caps.

create or replace function public._company_max_revenue(p_valuation numeric)
returns numeric
language sql
immutable
as $$
  -- Hard ceiling for numeric(20,2), with a softer cap tied to IPO valuation.
  select least(
    9999999999999999.99::numeric,
    greatest(
      public._company_initial_revenue(p_valuation) * 1000,
      1000000000000::numeric
    )
  );
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
  v_cap numeric;
  h int := least(greatest(coalesce(p_hours, 0), 0), 24);
begin
  if h < 1 then return; end if;

  for r in
    select id, revenue, growth_rate, strategy, valuation
    from public.businesses
    where revenue > 0
    for update
  loop
    v_cap := public._company_max_revenue(r.valuation);
    v_rate := least(public._company_effective_growth_rate(r.strategy, r.growth_rate), 0.5);
    v_new_revenue := round(least(r.revenue * power(1 + v_rate, h), v_cap), 2);
    update public.businesses set revenue = v_new_revenue where id = r.id;
  end loop;

  perform public._recalc_all_sector_market_shares();
end;
$$;

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
  v_hours := least(greatest(v_hours, 0), 24);
  if v_hours < 1 then return; end if;

  perform public._tick_all_company_revenue(v_hours);

  update public.simulation_settings
  set last_sector_market_tick_at = now()
  where id = 1;
end;
$$;

-- Repair runaway revenue from uncapped compounding (e.g. after long offline gaps).
update public.businesses b
set revenue = public._company_initial_revenue(b.valuation)
where b.revenue > public._company_max_revenue(b.valuation);

do $$
begin
  perform public._recalc_all_sector_market_shares();
end;
$$;

notify pgrst, 'reload schema';
