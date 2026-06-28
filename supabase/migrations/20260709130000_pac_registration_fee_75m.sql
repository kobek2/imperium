-- Raise PAC registration fee from $5M to $75M.

create or replace function public.economy_register_pac(p_name text, p_dark boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  price numeric := 75000000;
  v_name text := trim(coalesce(p_name, ''));
  w record;
  new_bal numeric;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  perform public._economy_require_active_budget();
  if v_name = '' or char_length(v_name) < 3 then raise exception 'PAC name must be at least 3 characters'; end if;
  if exists (select 1 from public.economy_pacs where user_id = v_uid) then raise exception 'PAC already registered'; end if;

  price := case when public._economy_dev_mode_enabled() then 0::numeric else price end;

  insert into public.economy_wallets (user_id) values (v_uid) on conflict do nothing;
  select * into w from public.economy_wallets where user_id = v_uid for update;
  if price > 0 and w.balance < price then
    raise exception 'Insufficient balance — $75,000,000 PAC registration fee required';
  end if;

  new_bal := w.balance - price;
  update public.economy_wallets set balance = new_bal, updated_at = now() where user_id = v_uid;

  insert into public.economy_pacs (user_id, pac_name, is_dark_money)
  values (v_uid, v_name, coalesce(p_dark, false));

  insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
  values (
    v_uid,
    -price,
    new_bal,
    'pac_purchase',
    jsonb_build_object('name', v_name, 'dark_money', coalesce(p_dark, false), 'dev_free', price = 0)
  );

  return jsonb_build_object('ok', true, 'balance', new_bal);
end;
$$;

notify pgrst, 'reload schema';
