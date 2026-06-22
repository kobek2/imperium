-- Fix economy wipe helper: TRUNCATE fails when FKs still reference parent rows (Supabase + sector_market_stats → businesses).

create or replace function public._admin_truncate_economy_market_state()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if to_regclass('public.bills') is not null then
    update public.bills set lobby_offer_id = null where lobby_offer_id is not null;
  end if;

  if to_regclass('public.pac_coordinations') is not null then
    delete from public.pac_coordinations where true;
  end if;
  if to_regclass('public.pac_contributions') is not null then
    delete from public.pac_contributions where true;
  end if;
  if to_regclass('public.corruption_deals') is not null then
    delete from public.corruption_deals where true;
  end if;
  if to_regclass('public.blackmail_demands') is not null then
    delete from public.blackmail_demands where true;
  end if;
  if to_regclass('public.corruption_ledger') is not null then
    delete from public.corruption_ledger where true;
  end if;
  if to_regclass('public.investigation_cooldowns') is not null then
    delete from public.investigation_cooldowns where true;
  end if;
  if to_regclass('public.npc_campaign_actions') is not null then
    delete from public.npc_campaign_actions where true;
  end if;
  if to_regclass('public.campaign_ads') is not null then
    delete from public.campaign_ads where true;
  end if;
  if to_regclass('public.company_bill_positions') is not null then
    delete from public.company_bill_positions where true;
  end if;
  if to_regclass('public.company_lobby_offers') is not null then
    delete from public.company_lobby_offers where true;
  end if;
  if to_regclass('public.market_event_companies') is not null then
    delete from public.market_event_companies where true;
  end if;
  if to_regclass('public.stock_trade_history') is not null then
    delete from public.stock_trade_history where true;
  end if;
  if to_regclass('public.stock_trades') is not null then
    delete from public.stock_trades where true;
  end if;
  if to_regclass('public.stock_holdings') is not null then
    delete from public.stock_holdings where true;
  end if;
  if to_regclass('public.business_price_history') is not null then
    delete from public.business_price_history where true;
  end if;
  if to_regclass('public.sector_market_stats') is not null then
    delete from public.sector_market_stats where true;
  end if;
  if to_regclass('public.businesses') is not null then
    delete from public.businesses where true;
  end if;
  if to_regclass('public.market_events') is not null then
    delete from public.market_events where true;
  end if;

  delete from public.economy_ledger where true;
  delete from public.economy_blackjack_sessions where true;
  delete from public.economy_inventory where true;
  delete from public.economy_pacs where true;
end;
$$;

revoke all on function public._admin_truncate_economy_market_state() from public;

notify pgrst, 'reload schema';
