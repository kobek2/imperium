-- Office salary: linear accrual over 24h per sim turn; remove stale player council grants.

alter table public.city_office_salary_ledger
  add column if not exists turn_started_at timestamptz not null default now();

update public.city_office_salary_ledger
set turn_started_at = coalesce(last_accrual_at, term_started_at, now())
where turn_started_at is null;

-- Remove player council seats (NPC ward roster is separate from government_role_grants).
delete from public.city_office_salary_ledger
where role_key = 'council_member';

delete from public.government_role_grants
where role_key = 'council_member';

update public.profiles
set office_role = null, updated_at = now()
where office_role = 'council_member'
  and not exists (
    select 1 from public.government_role_grants g
    where g.user_id = profiles.id and g.role_key = 'council_member'
  );

create or replace function public._city_office_salary_turn_hours()
returns numeric
language sql
immutable
as $$ select 24::numeric; $$;

create or replace function public.refresh_city_office_salary_accruals(p_city_code char(2) default 'MB')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
  turn_salary numeric;
  turn_hours numeric := public._city_office_salary_turn_hours();
  elapsed_hours numeric;
  new_accrued numeric;
  n int := 0;
begin
  for rec in
    select l.user_id, l.role_key, l.accrual_capped, l.turn_started_at
    from public.city_office_salary_ledger l
    where l.city_code = p_city_code
      and exists (
        select 1 from public.government_role_grants g
        where g.user_id = l.user_id and g.role_key = l.role_key
      )
  loop
    if rec.accrual_capped then
      continue;
    end if;

    turn_salary := public._city_office_salary_per_turn(rec.role_key);
    elapsed_hours := greatest(
      extract(epoch from (now() - coalesce(rec.turn_started_at, now()))) / 3600.0,
      0
    );

    if elapsed_hours >= turn_hours then
      new_accrued := turn_salary;
    else
      new_accrued := round(turn_salary * (elapsed_hours / turn_hours), 2);
    end if;

    update public.city_office_salary_ledger
    set
      accrued_usd = new_accrued,
      collection_deadline_at = rec.turn_started_at + make_interval(hours => turn_hours::int),
      last_accrual_at = now(),
      updated_at = now()
    where user_id = rec.user_id;
    n := n + 1;
  end loop;

  perform public._sync_city_office_salary_pool_column(p_city_code);
  return jsonb_build_object('ok', true, 'accruals', n);
end;
$$;

create or replace function public.tick_city_office_salaries(p_city_code char(2) default 'MB')
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.refresh_city_office_salary_accruals(p_city_code);
$$;

create or replace function public._open_city_office_salary_term(
  p_user_id uuid,
  p_role_key text,
  p_city_code char(2) default 'MB'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null or p_role_key not in ('mayor', 'council_member') then
    return;
  end if;

  insert into public.city_office_salary_ledger (
    user_id, city_code, role_key, term_started_at, accrued_usd, accrual_capped,
    turn_started_at, collection_deadline_at, last_accrual_at, collected_at, updated_at
  ) values (
    p_user_id, p_city_code, p_role_key, now(), 0, false,
    now(), now() + interval '24 hours', null, null, now()
  )
  on conflict (user_id) do update set
    city_code = excluded.city_code,
    role_key = excluded.role_key,
    term_started_at = now(),
    accrued_usd = 0,
    accrual_capped = false,
    turn_started_at = now(),
    collection_deadline_at = now() + interval '24 hours',
    last_accrual_at = null,
    collected_at = null,
    updated_at = now();

  perform public._sync_city_office_salary_pool_column(p_city_code);
end;
$$;

create or replace function public._city_sim_reset_salary_week(p_city_code char(2) default 'MB')
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.city_office_salary_ledger l
  set
    accrual_capped = false,
    turn_started_at = now(),
    collection_deadline_at = now() + interval '24 hours',
    updated_at = now()
  where l.city_code = p_city_code
    and exists (
      select 1 from public.government_role_grants g
      where g.user_id = l.user_id and g.role_key = l.role_key
    );
end;
$$;

create or replace function public.city_collect_office_salary(p_city_code char(2) default 'MB')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  led record;
  fiscal record;
  gross numeric;
  tax numeric;
  net numeric;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  perform public.refresh_city_office_salary_accruals(p_city_code);

  select * into led
  from public.city_office_salary_ledger
  where user_id = v_uid and city_code = p_city_code
  for update;

  if led.user_id is null then
    return jsonb_build_object('ok', false, 'message', 'No office salary on file.');
  end if;
  if led.accrued_usd <= 0 then
    return jsonb_build_object('ok', false, 'message', 'Nothing to collect yet.');
  end if;
  if not exists (
    select 1 from public.government_role_grants g
    where g.user_id = v_uid and g.role_key = led.role_key
  ) then
    return jsonb_build_object('ok', false, 'message', 'You no longer hold that office.');
  end if;

  gross := led.accrued_usd;
  select * into fiscal from public.city_fiscal_metrics where city_code = p_city_code;

  tax := 0;
  if fiscal.income_tax_enabled then
    if coalesce(fiscal.income_tax_flat, true) then
      tax := round(gross * (fiscal.income_tax_mid_pct / 100.0), 2);
    else
      tax := round(
        gross * (0.4 * fiscal.income_tax_low_pct + 0.4 * fiscal.income_tax_mid_pct + 0.2 * fiscal.income_tax_high_pct) / 100.0,
        2
      );
    end if;
  end if;
  net := gross - tax;

  insert into public.economy_wallets (user_id) values (v_uid) on conflict do nothing;
  update public.economy_wallets
  set balance = balance + net, last_collected_at = now(), updated_at = now()
  where user_id = v_uid;

  insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
  select v_uid, net, w.balance, 'city_office_salary',
    jsonb_build_object('gross', gross, 'city_income_tax', tax, 'role', led.role_key)
  from public.economy_wallets w where w.user_id = v_uid;

  update public.city_fiscal_metrics set
    salary_tax_revenue_millions = salary_tax_revenue_millions + (tax / 1000000.0),
    treasury_balance = treasury_balance + (tax / 1000000.0),
    updated_at = now()
  where city_code = p_city_code;

  update public.city_office_salary_ledger set
    accrued_usd = 0,
    turn_started_at = now(),
    collection_deadline_at = now() + interval '24 hours',
    collected_at = now(),
    updated_at = now()
  where user_id = v_uid;

  perform public._sync_city_office_salary_pool_column(p_city_code);

  return jsonb_build_object(
    'ok', true,
    'gross', gross,
    'city_income_tax', tax,
    'net', net,
    'role', led.role_key
  );
end;
$$;

-- GDP proxy for metrics: seated officeholders × per-turn salary × 5 turns/year.
create or replace function public._city_annual_office_salary_gdp_usd(p_city_code char(2) default 'MB')
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    sum(public._city_office_salary_per_turn(g.role_key)) * 5::numeric,
    0::numeric
  )
  from public.government_role_grants g
  where g.role_key in ('mayor', 'council_member');
$$;

create or replace function public.refresh_city_business_tax_revenue(p_city_code char(2) default 'MB')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
  annual_gdp_usd numeric;
  revenue_millions numeric;
begin
  select * into m from public.city_fiscal_metrics where city_code = p_city_code;
  if m.city_code is null then
    return jsonb_build_object('ok', false);
  end if;

  annual_gdp_usd := public._city_annual_office_salary_gdp_usd(p_city_code);

  if annual_gdp_usd > 0 then
    revenue_millions := annual_gdp_usd / 1000000.0;
  elsif m.population > 0 then
    revenue_millions := (
      m.population::numeric
      * greatest(0, least(100, coalesce(m.mayor_approval, 50))) / 100.0
      * 0.000014
      * m.population::numeric
    ) / 1000000.0;
  else
    revenue_millions := 0;
  end if;

  update public.city_fiscal_metrics set
    business_tax_revenue_millions = revenue_millions,
    updated_at = now()
  where city_code = p_city_code;

  return jsonb_build_object(
    'ok', true,
    'business_tax_revenue_millions', revenue_millions,
    'annual_office_salary_gdp_usd', annual_gdp_usd
  );
end;
$$;

-- Sim week advance: forfeit uncollected pay, start new 24h turn (no lump-sum bump).
create or replace function public.admin_advance_city_sim_week(
  p_city_code char(2) default 'MB',
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  eng record;
  new_year smallint;
  new_week smallint;
  capped int;
  turn_out jsonb;
  warnings text[] := '{}';
  rnd record;
  turns_per_year constant smallint := 5;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not public.is_staff_admin(v_uid) then raise exception 'Admin only'; end if;

  select * into eng from public.city_sim_engine_state where city_code = p_city_code for update;
  if eng.city_code is null then
    insert into public.city_sim_engine_state (city_code, sim_tick, sim_year, sim_week)
    values (p_city_code, 0, 1, 1)
    returning * into eng;
  end if;

  if not p_force and coalesce(
    (select sim.campaign_manager_active from public.simulation_settings sim where sim.id = 1),
    false
  ) then
    select * into rnd from public.legislative_rounds r
    where r.campaign_cycle = (select campaign_manager_cycle from public.simulation_settings where id = 1)
      and r.campaign_turn = (select campaign_manager_turn from public.simulation_settings where id = 1)
      and r.phase <> 'completed'
    order by r.created_at desc limit 1;

    if rnd.id is not null then
      warnings := array_append(warnings, format('Legislative round still in %s phase', rnd.phase));
    end if;
  end if;

  perform public.refresh_city_office_salary_accruals(p_city_code);
  capped := public._city_sim_cap_uncollected_salaries(p_city_code);

  new_week := eng.sim_week + 1;
  new_year := eng.sim_year;
  if new_week > turns_per_year then
    new_week := 1;
    new_year := new_year + 1;
  end if;

  update public.city_sim_engine_state
  set sim_year = new_year, sim_week = new_week, updated_at = now()
  where city_code = p_city_code;

  perform public._city_sim_reset_salary_week(p_city_code);
  perform public.refresh_city_business_tax_revenue(p_city_code);

  turn_out := public._campaign_advance_turn_internal(false);

  return jsonb_build_object(
    'ok', true,
    'sim_year', new_year,
    'sim_week', new_week,
    'sim_tick', eng.sim_tick,
    'salaries_forfeited', capped,
    'campaign_turn', turn_out,
    'warnings', warnings,
    'forced', p_force
  );
end;
$$;

grant execute on function public.refresh_city_office_salary_accruals(char) to authenticated, service_role;
grant execute on function public._city_annual_office_salary_gdp_usd(char) to authenticated, service_role;

do $$
begin
  perform public.refresh_city_office_salary_accruals('MB');
  perform public.refresh_city_business_tax_revenue('MB');
end;
$$;

notify pgrst, 'reload schema';
