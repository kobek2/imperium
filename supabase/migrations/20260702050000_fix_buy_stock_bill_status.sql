-- buy_stock referenced non-existent bill_status values ('enrolled', 'failed' as terminal).

create or replace function public.buy_stock(p_business uuid, p_shares integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  qty int := greatest(1, coalesce(p_shares, 0));
  biz record;
  cost numeric;
  w record;
  new_bal numeric;
  held int;
  new_price numeric;
  disclosed boolean;
  pending_bill uuid;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  perform public._economy_require_active_budget();

  select * into biz from public.businesses where id = p_business for update;
  if biz.id is null then raise exception 'Business not found'; end if;
  if biz.shares_available < qty then raise exception 'Not enough shares on market'; end if;

  cost := round(qty * biz.price_per_share, 2);
  insert into public.economy_wallets (user_id) values (v_uid) on conflict do nothing;
  select * into w from public.economy_wallets where user_id = v_uid for update;
  if w.balance < cost then raise exception 'Insufficient balance'; end if;

  new_bal := w.balance - cost;
  update public.economy_wallets set balance = new_bal, updated_at = now() where user_id = v_uid;

  update public.businesses
  set shares_available = shares_available - qty,
      treasury = treasury + cost,
      price_per_share = greatest(0.01, price_per_share * (1 + 0.005 * (qty / 100.0)))
  where id = p_business
  returning price_per_share into new_price;

  insert into public.stock_holdings (user_id, business_id, shares) values (v_uid, p_business, qty)
  on conflict (user_id, business_id) do update set shares = stock_holdings.shares + excluded.shares;

  select shares into held from public.stock_holdings where user_id = v_uid and business_id = p_business;
  disclosed := held >= ceil(biz.total_shares * 0.05);

  insert into public.stock_trades (user_id, business_id, trade_type, shares, price_at_trade, total_value, is_disclosed)
  values (v_uid, p_business, 'buy', qty, biz.price_per_share, cost, disclosed);

  select b.id into pending_bill
  from public.bills b
  join public.bill_votes bv on bv.bill_id = b.id and bv.voter_id = v_uid
  where b.sector_tag = biz.sector
    and b.status not in ('law', 'vetoed', 'dead', 'rejected', 'expired', 'failed')
  limit 1;
  if pending_bill is not null then
    insert into public.corruption_ledger (actor_user_id, action_type, amount, metadata)
    values (v_uid, 'insider_trade', cost, jsonb_build_object('business_id', p_business, 'sector', biz.sector, 'bill_id', pending_bill, 'shares', qty));
  end if;

  return jsonb_build_object('ok', true, 'balance', new_bal, 'shares_held', held, 'price_per_share', new_price);
end;
$$;
