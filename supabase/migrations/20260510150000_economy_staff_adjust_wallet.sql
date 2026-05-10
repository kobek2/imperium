-- Staff wallet credit/debit with ledger row (full staff or staff_economy).

create or replace function public.economy_staff_adjust_wallet(p_user_id uuid, p_delta numeric, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  w record;
  new_bal numeric;
  v_delta numeric := round(coalesce(p_delta, 0), 2);
  v_reason text := left(trim(coalesce(p_reason, '')), 500);
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_staff_economy_auditor(v_actor) then
    raise exception 'Only economy staff (admin, staff_super, or staff_economy) may adjust wallets.';
  end if;
  if p_user_id is null then
    raise exception 'User id required';
  end if;
  if v_delta = 0 then
    raise exception 'Delta must be non-zero';
  end if;
  if abs(v_delta) > 500000000 then
    raise exception 'Adjustment too large (max $500,000,000 per call)';
  end if;
  if length(v_reason) < 3 then
    raise exception 'Reason must be at least 3 characters';
  end if;

  if not exists (select 1 from public.profiles p where p.id = p_user_id) then
    raise exception 'Profile not found for that user id';
  end if;

  insert into public.economy_wallets (user_id) values (p_user_id) on conflict do nothing;
  select * into w from public.economy_wallets where user_id = p_user_id for update;

  new_bal := w.balance + v_delta;
  if new_bal < 0 then
    raise exception 'Resulting balance would be negative (current %, delta %).', w.balance, v_delta;
  end if;

  update public.economy_wallets set balance = new_bal, updated_at = now() where user_id = p_user_id;

  insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
  values (
    p_user_id,
    v_delta,
    new_bal,
    'staff_adjustment',
    jsonb_build_object(
      'reason', v_reason,
      'actor_user_id', v_actor
    )
  );

  return jsonb_build_object('ok', true, 'balance', new_bal);
end;
$$;

revoke all on function public.economy_staff_adjust_wallet(uuid, numeric, text) from public;
grant execute on function public.economy_staff_adjust_wallet(uuid, numeric, text) to authenticated;

comment on function public.economy_staff_adjust_wallet(uuid, numeric, text) is
  'Economy staff: add or subtract wallet balance with audit ledger row (kind staff_adjustment).';
