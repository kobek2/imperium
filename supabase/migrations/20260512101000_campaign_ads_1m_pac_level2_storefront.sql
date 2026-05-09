-- Align economy storefront rules with current UI:
-- - campaign ads cost $1,000,000 each
-- - PAC upgrades stop at level 2 for now

create or replace function public.economy_buy_campaign_ads(p_qty int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  unit_price numeric := 1000000;
  q int := greatest(1, least(coalesce(p_qty, 1), 5000));
  total numeric := unit_price * q;
  w record;
  new_bal numeric;
  new_qty int;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  perform public._economy_require_active_budget();

  insert into public.economy_wallets (user_id) values (v_uid) on conflict do nothing;
  select * into w from public.economy_wallets where user_id = v_uid for update;
  if w.balance < total then raise exception 'Insufficient balance'; end if;

  new_bal := w.balance - total;
  update public.economy_wallets set balance = new_bal, updated_at = now() where user_id = v_uid;

  insert into public.economy_inventory as i (user_id, sku, quantity)
  values (v_uid, 'campaign_ad', q)
  on conflict (user_id, sku) do update set quantity = i.quantity + excluded.quantity
  returning quantity into new_qty;

  insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
  values (v_uid, -total, new_bal, 'campaign_ad_buy', jsonb_build_object('qty', q, 'unit_price', unit_price));

  return jsonb_build_object('ok', true, 'balance', new_bal, 'campaign_ads', new_qty);
end;
$$;

create or replace function public.economy_upgrade_pac()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  cur int;
  price numeric;
  w record;
  new_bal numeric;
  new_lvl int;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  perform public._economy_require_active_budget();

  select level into cur from public.economy_pacs where user_id = v_uid for update;
  if cur is null then raise exception 'No PAC to upgrade'; end if;
  if cur >= 2 then raise exception 'PAC storefront currently supports up to level 2'; end if;

  price := 20000000::numeric;
  new_lvl := 2;

  insert into public.economy_wallets (user_id) values (v_uid) on conflict do nothing;
  select * into w from public.economy_wallets where user_id = v_uid for update;
  if w.balance < price then raise exception 'Insufficient balance'; end if;

  new_bal := w.balance - price;
  update public.economy_wallets set balance = new_bal, updated_at = now() where user_id = v_uid;
  update public.economy_pacs set level = new_lvl, updated_at = now() where user_id = v_uid;

  insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
  values (v_uid, -price, new_bal, 'pac_upgrade', jsonb_build_object('from_level', cur, 'to_level', new_lvl));

  return jsonb_build_object('ok', true, 'balance', new_bal, 'pac_level', new_lvl);
end;
$$;

notify pgrst, 'reload schema';
