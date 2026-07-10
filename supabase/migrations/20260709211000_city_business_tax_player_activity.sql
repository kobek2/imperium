-- Business tax revenue from real player wallet/ledger activity (with placeholder fallback).

create or replace function public._city_placeholder_business_tax_millions(
  p_population numeric,
  p_approval numeric,
  p_growth numeric default 0.000014
)
returns numeric
language sql
immutable
as $$
  select case
    when coalesce(p_population, 0) <= 0 then 0::numeric
    else (
      p_population
      * greatest(0::numeric, least(1::numeric, coalesce(p_approval, 50) / 100.0))
      * p_growth
      * p_population
    ) / 1000000.0
  end;
$$;

create or replace function public.get_city_player_business_activity(p_window_days int default 90)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  window_days int := greatest(7, least(365, coalesce(p_window_days, 90)));
  kinds text[] := array[
    'transfer_in', 'transfer_out',
    'campaign_ad', 'campaign_ad_buy', 'campaign_ad_spend',
    'business_investment', 'found_business',
    'pac_purchase', 'pac_upgrade', 'pac_deposit', 'pac_treasury_deposit',
    'gamble_blackjack', 'investigation', 'corruption', 'party_deposit'
  ];
  volume numeric := 0;
  active_players int := 0;
  tx_count int := 0;
  wallet_sum numeric := 0;
  annualized numeric := 0;
begin
  select
    coalesce(sum(abs(l.delta)), 0),
    count(distinct l.wallet_user_id),
    count(*)::int
  into volume, active_players, tx_count
  from public.economy_ledger l
  where l.kind = any(kinds)
    and l.created_at >= now() - make_interval(days => window_days);

  annualized := volume * (365.0 / window_days::numeric);

  select coalesce(sum(w.balance), 0) into wallet_sum
  from public.economy_wallets w
  where exists (
    select 1 from public.economy_ledger l
    where l.wallet_user_id = w.user_id
      and l.kind = any(kinds)
      and l.created_at >= now() - make_interval(days => window_days)
  );

  return jsonb_build_object(
    'ok', true,
    'window_days', window_days,
    'annualized_volume_usd', annualized,
    'active_players', active_players,
    'qualifying_transactions', tx_count,
    'wallet_balance_sum_usd', wallet_sum
  );
end;
$$;

create or replace function public.refresh_city_business_tax_revenue(p_city_code char(2) default 'MB')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
  activity jsonb;
  placeholder_m numeric;
  activity_m numeric;
  revenue_m numeric;
  annualized numeric;
  active_players int;
  tx_count int;
  player_scale numeric;
  volume_ratio numeric;
  meaningful boolean;
  source text := 'placeholder';
  growth numeric := 0.000014;
  min_players int := 3;
  min_tx int := 12;
  min_volume numeric := 5000000;
  ref_players numeric := 12;
  parity_volume numeric := 2000000000;
  multiplier_cap numeric := 2.5;
begin
  select * into m from public.city_fiscal_metrics where city_code = p_city_code;
  if m.city_code is null then
    return jsonb_build_object('ok', false);
  end if;

  activity := public.get_city_player_business_activity(90);
  annualized := coalesce((activity->>'annualized_volume_usd')::numeric, 0);
  active_players := coalesce((activity->>'active_players')::int, 0);
  tx_count := coalesce((activity->>'qualifying_transactions')::int, 0);

  placeholder_m := public._city_placeholder_business_tax_millions(
    m.population,
    greatest(0, least(100, coalesce(m.mayor_approval, 50))),
    growth
  );

  if active_players > 0 then
    player_scale := sqrt(active_players::numeric / ref_players);
    player_scale := greatest(0.55, least(1.45, player_scale));
  else
    player_scale := 0;
  end if;

  if parity_volume > 0 then
    volume_ratio := annualized / parity_volume;
  else
    volume_ratio := 0;
  end if;

  activity_m := placeholder_m * least(multiplier_cap, volume_ratio * player_scale);

  meaningful := active_players >= min_players
    and tx_count >= min_tx
    and annualized >= min_volume;

  if meaningful then
    revenue_m := activity_m;
    source := 'activity';
  else
    revenue_m := placeholder_m;
    source := 'placeholder';
  end if;

  update public.city_fiscal_metrics set
    business_tax_revenue_millions = revenue_m,
    updated_at = now()
  where city_code = p_city_code;

  return jsonb_build_object(
    'ok', true,
    'business_tax_revenue_millions', revenue_m,
    'placeholder_millions', placeholder_m,
    'activity_millions', activity_m,
    'source', source,
    'meaningful_activity', meaningful,
    'activity', activity
  );
end;
$$;

grant execute on function public.get_city_player_business_activity(int) to authenticated, service_role;
grant execute on function public._city_placeholder_business_tax_millions(numeric, numeric, numeric) to authenticated, service_role;

notify pgrst, 'reload schema';
