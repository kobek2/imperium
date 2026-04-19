-- PostgREST was returning: "Could not find the function public.economy_collect_income without parameters
-- in the schema cache" for supabase-js calls with `{}`. A single named jsonb argument matches reliably.
drop function if exists public.economy_collect_income();
drop function if exists public.economy_collect_income(jsonb);

create or replace function public.economy_collect_income(p_body jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  w record;
  v_hours int;
  v_role_hourly numeric;
  v_pac_hourly numeric := 0;
  v_total_hourly numeric;
  v_gross numeric;
  v_keys text[];
  pac_lvl int;
  new_bal numeric;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.economy_wallets (user_id) values (v_uid)
  on conflict (user_id) do nothing;

  select * into w from public.economy_wallets where user_id = v_uid for update;
  select public._economy_effective_role_keys(v_uid) into v_keys;
  v_role_hourly := public._economy_hourly_from_roles(v_keys);

  select level into pac_lvl from public.economy_pacs where user_id = v_uid;
  if pac_lvl is not null then
    v_pac_hourly := public._economy_pac_hourly(pac_lvl);
  end if;

  v_total_hourly := v_role_hourly + v_pac_hourly;
  v_hours := floor(extract(epoch from (now() - w.last_collected_at)) / 3600)::int;
  v_hours := least(greatest(v_hours, 0), 24);

  if v_hours < 1 or v_total_hourly <= 0 then
    return jsonb_build_object('ok', true, 'hours', v_hours, 'paid', 0, 'balance', w.balance);
  end if;

  v_gross := v_total_hourly * v_hours;
  new_bal := w.balance + v_gross;

  update public.economy_wallets
  set balance = new_bal,
      last_collected_at = now(),
      updated_at = now()
  where user_id = v_uid;

  insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
  values (
    v_uid,
    v_gross,
    new_bal,
    'hourly_income',
    jsonb_build_object(
      'hours', v_hours,
      'role_hourly', v_role_hourly,
      'pac_hourly', v_pac_hourly,
      'role_keys', to_jsonb(v_keys)
    )
  );

  return jsonb_build_object('ok', true, 'hours', v_hours, 'paid', v_gross, 'balance', new_bal);
end;
$$;

grant execute on function public.economy_collect_income(jsonb) to authenticated;
grant execute on function public.economy_collect_income(jsonb) to service_role;

notify pgrst, 'reload schema';
