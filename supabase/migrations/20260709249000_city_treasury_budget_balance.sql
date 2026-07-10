-- Treasury = cumulative enacted budget balance (revenue − spending per biennium).
-- Align SQL revenue with player office-salary tax (not 8M-population macro when players hold office).

create or replace function public._city_has_seated_player_officeholders(p_city_code char(2) default 'MB')
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.government_role_grants g
    where g.role_key in ('mayor', 'council_member')
  );
$$;

create or replace function public._city_annual_office_income_tax_millions(p_city_code char(2) default 'MB')
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  m record;
  holder record;
  annual_gross numeric;
  holder_tax numeric;
  total_tax numeric := 0;
  low_cap numeric := 50000;
  mid_cap numeric := 150000;
begin
  select * into m from public.city_fiscal_metrics where city_code = p_city_code;
  if m.city_code is null or not coalesce(m.income_tax_enabled, false) then
    return 0;
  end if;

  for holder in
    select g.role_key
    from public.government_role_grants g
    where g.role_key in ('mayor', 'council_member')
  loop
    annual_gross := public._city_office_salary_per_turn(holder.role_key) * 5;
    if annual_gross <= 0 then
      continue;
    end if;

    if coalesce(m.income_tax_flat, true) then
      holder_tax := annual_gross * (m.income_tax_mid_pct / 100.0);
    else
      holder_tax :=
        least(annual_gross, low_cap) * (m.income_tax_low_pct / 100.0)
        + greatest(least(annual_gross, mid_cap) - low_cap, 0) * (m.income_tax_mid_pct / 100.0)
        + greatest(annual_gross - mid_cap, 0) * (m.income_tax_high_pct / 100.0);
    end if;

    total_tax := total_tax + holder_tax;
  end loop;

  return total_tax / 1000000.0;
end;
$$;

create or replace function public._city_annual_budget_revenue_millions(p_city_code char(2) default 'MB')
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  m record;
  pe jsonb;
  economy_mult numeric;
  property_rev numeric := 0;
  income_rev numeric := 0;
  business_rev numeric := 0;
  wallet_sum numeric := 0;
  wallet_players int := 0;
  annualized_wage numeric := 0;
  meaningful boolean := false;
  blended_rate numeric;
begin
  select * into m from public.city_fiscal_metrics where city_code = p_city_code;
  if m.city_code is null then
    return 0;
  end if;

  if public._city_has_seated_player_officeholders(p_city_code) then
    return public._city_annual_office_income_tax_millions(p_city_code)
      + coalesce(m.cannabis_sales_tax_revenue_millions, 0)
      + coalesce(m.local_sales_tax_revenue_millions, 0);
  end if;

  pe := public.get_city_player_economy_snapshot(90);
  wallet_sum := coalesce((pe->>'wallet_balance_sum_usd')::numeric, 0);
  wallet_players := coalesce((pe->>'wallet_player_count')::int, 0);
  annualized_wage := coalesce((pe->>'annualized_wage_usd')::numeric, 0);
  meaningful := wallet_players >= 2 and wallet_sum >= 50000;

  economy_mult := case when m.economy_index > 0 then m.economy_index / 100.0 else 1 end;

  if meaningful then
    if m.property_tax_rate_pct > 0 then
      property_rev := (wallet_sum * 0.25 * economy_mult * (m.property_tax_rate_pct / 100.0)) / 1000000.0;
    end if;

    if m.income_tax_enabled and annualized_wage > 0 then
      blended_rate := (0.4 * m.income_tax_low_pct + 0.4 * m.income_tax_mid_pct + 0.2 * m.income_tax_high_pct) / 100.0;
      income_rev := (annualized_wage * economy_mult * blended_rate) / 1000000.0;
    end if;

    business_rev := public._player_business_tax_millions(coalesce(m.business_tax_rate_pct, 1.5));
    return property_rev + income_rev + business_rev
      + coalesce(m.cannabis_sales_tax_revenue_millions, 0)
      + coalesce(m.local_sales_tax_revenue_millions, 0);
  end if;

  -- NPC-only / pre-player city: macro fallback (no seated players, thin wallet economy).
  if m.population > 0 and m.property_tax_rate_pct > 0 then
    property_rev := (
      m.population * m.avg_household_income * 0.3 * economy_mult * (m.property_tax_rate_pct / 100.0)
    ) / 1000000.0;
  end if;

  if m.income_tax_enabled and m.population > 0 then
    blended_rate := (0.4 * m.income_tax_low_pct + 0.4 * m.income_tax_mid_pct + 0.2 * m.income_tax_high_pct) / 100.0;
    income_rev := (m.population * m.avg_household_income * economy_mult * blended_rate) / 1000000.0;
  end if;

  business_rev := coalesce(m.business_tax_revenue_millions, 0);

  return property_rev + income_rev + business_rev
    + coalesce(m.intergovernmental_aid_millions, 0)
    + coalesce(m.cannabis_sales_tax_revenue_millions, 0)
    + coalesce(m.local_sales_tax_revenue_millions, 0);
end;
$$;

create or replace function public._city_fiscal_revenue_millions(p_city_code char(2) default 'MB')
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select public._city_annual_budget_revenue_millions(p_city_code);
$$;

create or replace function public._city_biennial_fiscal_revenue_millions(p_city_code char(2) default 'MB')
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select public._city_annual_budget_revenue_millions(p_city_code) * public._city_budget_cycle_years();
$$;

create or replace function public._apply_enacted_city_budget(p_budget_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b record;
  line record;
  rev numeric;
  exp numeric;
  def numeric;
begin
  select * into b from public.city_budgets where id = p_budget_id;
  if b.id is null then raise exception 'Budget not found'; end if;

  select coalesce(sum(amount_millions), 0) into exp
  from public.city_budget_lines
  where budget_id = p_budget_id;

  rev := coalesce(
    b.projected_revenue_millions,
    public._city_biennial_fiscal_revenue_millions('MB')
  );
  exp := coalesce(b.projected_expenditure_millions, exp);
  def := coalesce(b.projected_deficit_millions, rev - exp);

  update public.city_budgets
  set
    projected_revenue_millions = rev,
    projected_expenditure_millions = exp,
    projected_deficit_millions = def
  where id = p_budget_id;

  for line in
    select department_key, amount_millions
    from public.city_budget_lines
    where budget_id = p_budget_id
  loop
    update public.city_fiscal_department_allocations
    set amount_millions = line.amount_millions,
        minimum_required_millions = public._city_dept_minimum_millions(line.department_key)
    where city_code = 'MB' and department_key = line.department_key;
  end loop;

  update public.city_fiscal_metrics set
    treasury_balance = treasury_balance + def,
    fiscal_year = fiscal_year + 1,
    updated_at = now()
  where city_code = 'MB';

  perform public.recompute_mayor_electoral_approval('MB');
  perform public._apply_budget_sim_effects(p_budget_id, def);
end;
$$;

create or replace function public.finalize_city_budget_vote(p_budget_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b record;
  cm record;
  vote text;
  yeas smallint := 0;
  nays smallint := 0;
  player_voted boolean;
  rev numeric;
  exp numeric;
  def numeric;
  baseline numeric;
  delta_pct numeric;
  need_yeas smallint := 4;
  v_label text;
  v_user_id uuid;
  seat_count int := 0;
begin
  select * into b from public.city_budgets where id = p_budget_id;
  if b.id is null then raise exception 'Budget not found'; end if;
  if b.status <> 'council_vote' then raise exception 'Budget is not open for council vote'; end if;

  rev := public._city_biennial_fiscal_revenue_millions('MB');
  select coalesce(sum(amount_millions), 0) into exp from public.city_budget_lines where budget_id = p_budget_id;
  def := rev - exp;

  select coalesce(sum(amount_millions), 0) into baseline
  from public.city_fiscal_department_allocations where city_code = 'MB';

  delta_pct := case when baseline > 0 then ((exp - baseline) / baseline) * 100 else 0 end;

  if def < -800 then need_yeas := 5; end if;

  select count(*)::int into seat_count
  from public.campaign_caucus_members
  where chamber = 'council';

  delete from public.city_budget_roll_calls where budget_id = p_budget_id;

  if seat_count = 0 then
    update public.city_budgets set
      council_yeas = 0,
      council_nays = 0,
      projected_revenue_millions = rev,
      projected_expenditure_millions = exp,
      projected_deficit_millions = def,
      status = 'awaiting_mayor'
    where id = p_budget_id;
    return jsonb_build_object(
      'ok', true, 'passed', true, 'yeas', 0, 'nays', 0,
      'status', 'awaiting_mayor', 'deficit_millions', def,
      'supermajority_required', false, 'empty_council', true
    );
  end if;

  for cm in
    select c.party, c.holder_user_id, c.seat_label, c.sim_politician_id, sp.character_name
    from public.campaign_caucus_members c
    join public.sim_politicians sp on sp.id = c.sim_politician_id
    where c.chamber = 'council'
    order by c.sort_order
  loop
    player_voted := false;
    v_user_id := cm.holder_user_id;
    v_label := cm.character_name;

    if cm.holder_user_id is not null then
      select v.vote, coalesce(pr.character_name, pr.discord_username, cm.character_name)
      into vote, v_label
      from public.city_budget_member_votes v
      left join public.profiles pr on pr.id = v.user_id
      where v.budget_id = p_budget_id and v.user_id = cm.holder_user_id;
      if found then
        player_voted := true;
        if vote = 'yea' then yeas := yeas + 1; else nays := nays + 1; end if;
      end if;
    end if;

    if not player_voted then
      vote := public._npc_budget_vote(cm.sim_politician_id, def, delta_pct);
      v_user_id := null;
      if vote = 'yea' then yeas := yeas + 1; else nays := nays + 1; end if;
    end if;

    insert into public.city_budget_roll_calls (
      budget_id, ward_code, voter_label, sim_politician_id, user_id, vote
    ) values (
      p_budget_id,
      cm.seat_label,
      coalesce(v_label, cm.character_name),
      cm.sim_politician_id,
      v_user_id,
      vote
    );
  end loop;

  update public.city_budgets set
    council_yeas = yeas,
    council_nays = nays,
    projected_revenue_millions = rev,
    projected_expenditure_millions = exp,
    projected_deficit_millions = def
  where id = p_budget_id;

  if yeas >= need_yeas then
    update public.city_budgets set status = 'awaiting_mayor' where id = p_budget_id;
    return jsonb_build_object(
      'ok', true, 'passed', true, 'yeas', yeas, 'nays', nays,
      'status', 'awaiting_mayor', 'deficit_millions', def,
      'supermajority_required', need_yeas > 4
    );
  end if;

  update public.city_budgets set status = 'rejected' where id = p_budget_id;
  return jsonb_build_object(
    'ok', true, 'passed', false, 'yeas', yeas, 'nays', nays,
    'status', 'rejected', 'deficit_millions', def
  );
end;
$$;

create or replace function public.mayor_sign_budget(p_budget_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b record;
  def numeric;
  treasury numeric;
  effect_summary text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  if not exists (
    select 1 from public.government_role_grants g
    where g.user_id = auth.uid() and g.role_key in ('mayor', 'admin')
  ) and not public.is_staff_admin(auth.uid()) then
    raise exception 'Only the mayor may sign the city budget';
  end if;

  select * into b from public.city_budgets where id = p_budget_id;
  if b.id is null then raise exception 'Budget not found'; end if;
  if b.status <> 'awaiting_mayor' then raise exception 'Budget is not awaiting mayor signature'; end if;

  def := coalesce(b.projected_deficit_millions, 0);

  update public.city_budgets set status = 'enacted', enacted_at = now() where id = p_budget_id;
  perform public._apply_enacted_city_budget(p_budget_id);

  select treasury_balance into treasury
  from public.city_fiscal_metrics
  where city_code = 'MB';

  select e.summary into effect_summary
  from public.city_sim_effect_events e
  where e.source_type = 'budget' and e.source_id = p_budget_id
  order by e.created_at desc
  limit 1;

  return jsonb_build_object(
    'ok', true,
    'status', 'enacted',
    'budget_id', p_budget_id,
    'deficit_millions', def,
    'treasury_balance_millions', treasury,
    'summary', coalesce(effect_summary, 'Budget enacted.')
  );
end;
$$;

-- Salary withholding is not separate treasury cash; only enacted budgets move treasury.
create or replace function public.collect_city_office_salary(p_city_code char(2) default 'MB')
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

-- Rebuild treasury from enacted biennial balances only.
update public.city_fiscal_metrics m
set treasury_balance = coalesce((
  select sum(b.projected_deficit_millions)
  from public.city_budgets b
  where b.status = 'enacted'
), 0),
updated_at = now()
where m.city_code = 'MB';

grant execute on function public._city_has_seated_player_officeholders(char) to authenticated, service_role;
grant execute on function public._city_annual_office_income_tax_millions(char) to authenticated, service_role;
grant execute on function public._city_annual_budget_revenue_millions(char) to authenticated, service_role;

notify pgrst, 'reload schema';
