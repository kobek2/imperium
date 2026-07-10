-- City budget revenue from player wallets + wage ledger (macro fallback when economy is thin).

create or replace function public._city_intergov_aid_scale(p_wallet_sum numeric)
returns numeric
language sql
immutable
as $$
  select greatest(
    0.05::numeric,
    least(1::numeric, sqrt(greatest(coalesce(p_wallet_sum, 0), 0) / 500000000.0))
  );
$$;

create or replace function public.get_city_player_economy_snapshot(p_window_days int default 90)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  window_days int := greatest(7, least(365, coalesce(p_window_days, 90)));
  wallet_sum numeric := 0;
  wallet_players int := 0;
  wage_volume numeric := 0;
  wage_players int := 0;
  wage_tx int := 0;
  annualized_wage numeric := 0;
  business jsonb;
begin
  select coalesce(sum(w.balance), 0), count(*)::int
  into wallet_sum, wallet_players
  from public.economy_wallets w
  where w.balance > 0;

  select
    coalesce(sum(greatest(l.delta, 0)), 0),
    count(distinct l.wallet_user_id),
    count(*)::int
  into wage_volume, wage_players, wage_tx
  from public.economy_ledger l
  where l.kind in ('hourly_income', 'income_collect')
    and l.created_at >= now() - make_interval(days => window_days);

  annualized_wage := wage_volume * (365.0 / window_days::numeric);
  business := public.get_city_player_business_activity(window_days);

  return jsonb_build_object(
    'ok', true,
    'window_days', window_days,
    'wallet_balance_sum_usd', wallet_sum,
    'wallet_player_count', wallet_players,
    'annualized_wage_usd', annualized_wage,
    'wage_player_count', wage_players,
    'wage_transactions', wage_tx,
    'business_activity', business
  );
end;
$$;

create or replace function public._city_fiscal_revenue_millions(p_city_code char(2) default 'MB')
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  m record;
  pe jsonb;
  economy_mult numeric;
  property_rev numeric := 0;
  income_rev numeric := 0;
  business_rev numeric := 0;
  salary_rev numeric := 0;
  intergov numeric := 0;
  blended_rate numeric;
  wallet_sum numeric := 0;
  wallet_players int := 0;
  annualized_wage numeric := 0;
  meaningful boolean := false;
begin
  select * into m from public.city_fiscal_metrics where city_code = p_city_code;
  if m.city_code is null then return 0; end if;

  pe := public.get_city_player_economy_snapshot(90);
  wallet_sum := coalesce((pe->>'wallet_balance_sum_usd')::numeric, 0);
  wallet_players := coalesce((pe->>'wallet_player_count')::int, 0);
  annualized_wage := coalesce((pe->>'annualized_wage_usd')::numeric, 0);

  meaningful := wallet_players >= 2 and wallet_sum >= 50000;

  economy_mult := case when m.economy_index > 0 then m.economy_index / 100.0 else 1 end;
  business_rev := coalesce(m.business_tax_revenue_millions, 0);
  salary_rev := coalesce(m.salary_tax_revenue_millions, 0);

  if meaningful then
    if m.property_tax_rate_pct > 0 then
      property_rev := (
        wallet_sum * 0.25 * economy_mult * (m.property_tax_rate_pct / 100.0)
      ) / 1000000.0;
    end if;

    if m.income_tax_enabled and annualized_wage > 0 then
      blended_rate := (0.4 * m.income_tax_low_pct + 0.4 * m.income_tax_mid_pct + 0.2 * m.income_tax_high_pct) / 100.0;
      income_rev := (annualized_wage * economy_mult * blended_rate) / 1000000.0;
    end if;

    intergov := coalesce(m.intergovernmental_aid_millions, 0)
      * public._city_intergov_aid_scale(wallet_sum);
  else
    if m.population > 0 and m.property_tax_rate_pct > 0 then
      property_rev := (
        m.population * m.avg_household_income * 0.3 * economy_mult * (m.property_tax_rate_pct / 100.0)
      ) / 1000000.0;
    end if;

    if m.income_tax_enabled and m.population > 0 then
      blended_rate := (0.4 * m.income_tax_low_pct + 0.4 * m.income_tax_mid_pct + 0.2 * m.income_tax_high_pct) / 100.0;
      income_rev := (m.population * m.avg_household_income * economy_mult * blended_rate) / 1000000.0;
    end if;

    intergov := coalesce(m.intergovernmental_aid_millions, 0);
  end if;

  return intergov + property_rev + income_rev + business_rev + salary_rev;
end;
$$;

grant execute on function public.get_city_player_economy_snapshot(int) to authenticated, service_role;
grant execute on function public._city_intergov_aid_scale(numeric) to authenticated, service_role;

notify pgrst, 'reload schema';
