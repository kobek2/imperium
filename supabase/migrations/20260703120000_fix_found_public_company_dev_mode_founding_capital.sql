-- Dev mode waives the wallet charge but founding_capital must stay > 0.

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
