-- Local/dev economy testing: waive PAC purchase costs, skip budget gates, grant test cash.

alter table public.simulation_settings
  add column if not exists economy_dev_mode boolean not null default false;

comment on column public.simulation_settings.economy_dev_mode is
  'When true: PAC registration/upgrades are free, economy budget gates are skipped, and economy_dev_grant_wallet is allowed. Enable via supabase/seed.sql for local dev only.';

create or replace function public._economy_dev_mode_enabled()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select s.economy_dev_mode from public.simulation_settings s where s.id = 1 limit 1),
    false
  );
$$;

-- Skip fiscal-year / shutdown gates while dev mode is on.
create or replace function public._economy_require_active_budget()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public._economy_dev_mode_enabled() then
    return;
  end if;

  if exists (
    select 1
    from public.rp_fiscal_years y
    where y.status = 'active' and coalesce(y.economy_activity_frozen, false)
  ) then
    raise exception
      'ECONOMY_FROZEN: Government shutdown in effect. No economic activity permitted.';
  end if;

  if exists (
    select 1
    from public.rp_fiscal_years y
    where y.status = 'active'
      and y.appropriation_deadline_at is not null
      and y.appropriations_act_bill_id is null
      and now() > y.appropriation_deadline_at
  ) then
    raise exception
      'Federal government shutdown: the annual appropriations act was not enrolled before the statutory deadline. Economy payouts and purchases are suspended until Congress enrolls appropriations.';
  end if;

  if not exists (
    select 1
    from public.rp_fiscal_years y
    join public.federal_budgets b on b.fiscal_year_id = y.id
    where y.status = 'active' and b.status = 'submitted'
  ) then
    raise exception 'Economy is frozen until the President submits a federal budget for the active fiscal year.';
  end if;
end;
$$;

create or replace function public.economy_dev_grant_wallet(p_amount numeric default 100000000)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  w record;
  v_amount numeric := round(greatest(coalesce(p_amount, 0), 0), 2);
  new_bal numeric;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if not public._economy_dev_mode_enabled() then
    raise exception 'Dev economy tools are disabled (simulation_settings.economy_dev_mode = false).';
  end if;
  if v_amount <= 0 then
    raise exception 'Amount must be positive';
  end if;
  if v_amount > 500000000 then
    raise exception 'Dev grant too large (max $500,000,000 per call)';
  end if;

  insert into public.economy_wallets (user_id) values (v_uid) on conflict do nothing;
  select * into w from public.economy_wallets where user_id = v_uid for update;

  new_bal := w.balance + v_amount;
  update public.economy_wallets set balance = new_bal, updated_at = now() where user_id = v_uid;

  insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
  values (
    v_uid,
    v_amount,
    new_bal,
    'dev_grant',
    jsonb_build_object('reason', 'economy_dev_grant_wallet')
  );

  return jsonb_build_object('ok', true, 'balance', new_bal, 'granted', v_amount);
end;
$$;

grant execute on function public.economy_dev_grant_wallet(numeric) to authenticated;

create or replace function public.economy_buy_pac(p_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  price numeric;
  v_name text := trim(coalesce(p_name, ''));
  w record;
  new_bal numeric;
  pac_id uuid;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  perform public._economy_require_active_budget();

  if v_name = '' or char_length(v_name) < 3 then
    raise exception 'PAC name must be at least 3 characters';
  end if;

  if exists (select 1 from public.pac_organizations where owner_user_id = v_uid) then
    raise exception 'PAC already registered';
  end if;

  price := case when public._economy_dev_mode_enabled() then 0::numeric else 5000000::numeric end;

  insert into public.economy_wallets (user_id) values (v_uid) on conflict do nothing;
  select * into w from public.economy_wallets where user_id = v_uid for update;
  if price > 0 and w.balance < price then raise exception 'Insufficient balance'; end if;

  new_bal := w.balance - price;
  update public.economy_wallets set balance = new_bal, updated_at = now() where user_id = v_uid;

  insert into public.pac_organizations (
    owner_user_id, name, tier, treasury_balance, revenue_hourly,
    shares_outstanding, float_shares_available, share_price
  ) values (
    v_uid, v_name, 1, 1000000, public._pac_tier_revenue_hourly(1),
    10000, 4000, 1000
  ) returning id into pac_id;

  perform public._pac_refresh_share_price(pac_id);

  insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
  values (
    v_uid,
    -price,
    new_bal,
    'pac_purchase',
    jsonb_build_object('tier', 1, 'pac_id', pac_id, 'name', v_name, 'dev_free', price = 0)
  );

  return jsonb_build_object('ok', true, 'balance', new_bal, 'pac_tier', 1, 'pac_id', pac_id);
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
  pac_row record;
  price numeric;
  w record;
  new_bal numeric;
  new_tier int;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  perform public._economy_require_active_budget();

  select * into pac_row from public.pac_organizations where owner_user_id = v_uid for update;
  if pac_row.id is null then raise exception 'No PAC to upgrade'; end if;
  if pac_row.tier >= 3 then raise exception 'PAC already max tier'; end if;

  price := case
    when public._economy_dev_mode_enabled() then 0::numeric
    else public._pac_tier_upgrade_cost(pac_row.tier)
  end;
  if price is null and not public._economy_dev_mode_enabled() then
    raise exception 'PAC cannot be upgraded further';
  end if;
  new_tier := pac_row.tier + 1;

  insert into public.economy_wallets (user_id) values (v_uid) on conflict do nothing;
  select * into w from public.economy_wallets where user_id = v_uid for update;
  if price > 0 and w.balance < price then raise exception 'Insufficient balance'; end if;

  new_bal := w.balance - price;
  update public.economy_wallets set balance = new_bal, updated_at = now() where user_id = v_uid;

  update public.pac_organizations
  set tier = new_tier,
      revenue_hourly = public._pac_tier_revenue_hourly(new_tier),
      updated_at = now()
  where id = pac_row.id;

  perform public._pac_refresh_share_price(pac_row.id);

  insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
  values (
    v_uid,
    -price,
    new_bal,
    'pac_upgrade',
    jsonb_build_object('from_tier', pac_row.tier, 'to_tier', new_tier, 'pac_id', pac_row.id, 'dev_free', price = 0)
  );

  return jsonb_build_object('ok', true, 'balance', new_bal, 'pac_tier', new_tier);
end;
$$;

notify pgrst, 'reload schema';
