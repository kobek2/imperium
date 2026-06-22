-- Sector legislation: always apply the configured % to share price, even when
-- market_premium is already at its 4.0× ceiling (premium-only bumps were invisible).

create or replace function public._legislation_apply_stock_market_effect()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  biz record;
  v_sector public.business_sector;
  effect_pct numeric;
  multiplier numeric;
  event_id uuid;
  price_before numeric;
  price_after numeric;
  target_price numeric;
  new_premium numeric;
  new_valuation numeric;
  price_floor numeric := 0.01;
  company_names text[] := '{}';
begin
  if new.status is distinct from 'law'::public.bill_status then
    return new;
  end if;
  if old.status = 'law'::public.bill_status then
    return new;
  end if;

  v_sector := coalesce(new.affected_sector, new.sector_tag);
  effect_pct := new.stock_market_effect;

  if v_sector is null then
    return new;
  end if;

  if effect_pct is null then
    effect_pct := case
      when lower(coalesce(new.policy_tags ->> 'stance_key', '')) like '%oppose%'
        or coalesce((new.policy_tags ->> 'policy_value')::numeric, 0) < 0 then -20
      else 20
    end;
  end if;

  if effect_pct = 0 then
    return new;
  end if;

  multiplier := 1 + (effect_pct / 100.0);

  insert into public.market_events (bill_id, headline, affected_sector, sector_effect_pct)
  values (new.id, new.title || ' Passed', v_sector, effect_pct)
  returning id into event_id;

  for biz in
    select
      b.id,
      b.name,
      b.ticker_symbol,
      b.price_per_share,
      b.market_premium,
      b.valuation,
      b.total_shares
    from public.businesses b
    where b.sector = v_sector
  loop
    price_before := coalesce(biz.price_per_share, 0);
    target_price := round(greatest(price_floor, price_before * multiplier), 4);
    new_premium := greatest(0.25, least(4.0, coalesce(biz.market_premium, 1.0) * multiplier));

    if coalesce(biz.valuation, 0) > 0 and coalesce(biz.total_shares, 0) > 0 then
      -- Recalibrate valuation so base × premium equals the legislated target price.
      new_valuation := round((target_price / new_premium) * biz.total_shares, 2);

      update public.businesses
      set
        market_premium = new_premium,
        valuation = new_valuation
      where id = biz.id;

      price_after := public._business_refresh_share_price(biz.id);
    else
      update public.businesses
      set market_premium = new_premium
      where id = biz.id;

      price_after := public._business_refresh_share_price(biz.id);

      if abs(price_after - target_price) > 0.00005 then
        update public.businesses
        set price_per_share = target_price
        where id = biz.id;

        perform public._business_record_price_history(biz.id, target_price);
        price_after := target_price;
      end if;
    end if;

    insert into public.market_event_companies (
      market_event_id, company_id, company_name, ticker_symbol, price_before, price_after
    ) values (
      event_id, biz.id, biz.name, biz.ticker_symbol, price_before, price_after
    );

    company_names := array_append(company_names, biz.name);
  end loop;

  return new;
end;
$$;

notify pgrst, 'reload schema';
