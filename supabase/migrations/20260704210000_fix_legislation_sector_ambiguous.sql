-- Fix PL/pgSQL variable name shadowing businesses.sector in enactment trigger.

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
    select b.id, b.name, b.ticker_symbol, b.price_per_share, b.market_premium
    from public.businesses b
    where b.sector = v_sector
  loop
    price_before := coalesce(biz.price_per_share, 0);

    update public.businesses
    set market_premium = greatest(0.25, least(4.0, coalesce(biz.market_premium, 1.0) * multiplier))
    where id = biz.id;

    price_after := public._business_refresh_share_price(biz.id);

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
