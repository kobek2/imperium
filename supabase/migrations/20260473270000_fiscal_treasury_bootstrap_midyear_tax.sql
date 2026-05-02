-- Playable tax ledger before the first fiscal_close_year(): seed fiscal_tax_accounts on the
-- active fiscal year once a federal budget is submitted, so Treasury warnings/penalties work.

create or replace function public._fiscal_treasury_bootstrap_tax_accounts_if_needed()
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  y record;
  bud record;
  u record;
  v_started timestamptz;
  v_inflow numeric;
  v_tax numeric;
begin
  select fy.* into y
  from public.rp_fiscal_years fy
  join public.federal_budgets fb on fb.fiscal_year_id = fy.id and fb.status = 'submitted'
  where fy.status = 'active'
  limit 1;
  if not found then
    select fy.* into y
    from public.rp_fiscal_years fy
    join public.federal_budgets fb on fb.fiscal_year_id = fy.id and fb.status = 'submitted'
    order by fy.year_index desc
    limit 1;
  end if;
  if not found then
    return;
  end if;

  if exists (select 1 from public.fiscal_tax_accounts a where a.fiscal_year_id = y.id) then
    return;
  end if;

  select * into bud from public.federal_budgets where fiscal_year_id = y.id limit 1;
  if not found then
    return;
  end if;

  v_started := y.started_at;

  for u in select id from public.profiles
  loop
    select coalesce(sum(delta), 0) into v_inflow
    from public.economy_ledger
    where wallet_user_id = u.id
      and kind = 'hourly_income'
      and delta > 0
      and created_at >= v_started;

    v_tax := public.fiscal_marginal_tax(v_inflow, bud.tax_brackets);
    if v_tax < 1 then
      v_tax := 25;
    end if;

    insert into public.fiscal_tax_accounts (
      fiscal_year_id,
      user_id,
      assessed_tax,
      paid_amount,
      outstanding_amount,
      due_at,
      status
    ) values (
      y.id,
      u.id,
      v_tax,
      0,
      v_tax,
      -- Past due so Treasury “due soon” / “delinquent” actions immediately match in dev and fresh installs.
      now() - interval '1 day',
      'pending'
    )
    on conflict (fiscal_year_id, user_id) do nothing;
  end loop;
end;
$$;

create or replace function public.fiscal_treasury_dashboard()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  y record;
  assessed numeric := 0;
  paid numeric := 0;
  outstanding numeric := 0;
  delinquent_count int := 0;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not public._fiscal_is_treasury_officer(v_uid) then
    raise exception 'Treasury authorization required.';
  end if;

  perform public._fiscal_treasury_bootstrap_tax_accounts_if_needed();

  select fy.* into y
  from public.rp_fiscal_years fy
  where exists (select 1 from public.fiscal_tax_accounts a where a.fiscal_year_id = fy.id)
  order by fy.year_index desc
  limit 1;
  if not found then
    return jsonb_build_object('fiscal_year_id', null, 'assessed', 0, 'paid', 0, 'outstanding', 0, 'delinquent_count', 0);
  end if;

  select
    coalesce(sum(a.assessed_tax), 0),
    coalesce(sum(a.paid_amount), 0),
    coalesce(sum(a.outstanding_amount), 0),
    coalesce(sum(
      case
        when a.status = 'delinquent' or (a.outstanding_amount > 0 and now()::date > a.due_at::date) then 1
        else 0
      end
    ), 0)::int
  into assessed, paid, outstanding, delinquent_count
  from public.fiscal_tax_accounts a
  where a.fiscal_year_id = y.id;

  return jsonb_build_object(
    'fiscal_year_id', y.id,
    'assessed', assessed,
    'paid', paid,
    'outstanding', outstanding,
    'delinquent_count', delinquent_count
  );
end;
$$;

create or replace function public.fiscal_issue_tax_warning(p_scope text default 'due_soon')
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  y record;
  warned int := 0;
  row_rec record;
  v_lead int;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not public._fiscal_is_treasury_officer(v_uid) then
    raise exception 'Treasury authorization required.';
  end if;

  perform public._fiscal_treasury_bootstrap_tax_accounts_if_needed();

  select fy.* into y
  from public.rp_fiscal_years fy
  where exists (select 1 from public.fiscal_tax_accounts a where a.fiscal_year_id = fy.id)
  order by fy.year_index desc
  limit 1;
  if not found then
    return jsonb_build_object('ok', true, 'warned', 0);
  end if;

  v_lead := greatest(1, coalesce(y.tax_warning_lead_days, 2));

  for row_rec in
    select a.*
    from public.fiscal_tax_accounts a
    where a.fiscal_year_id = y.id
      and a.outstanding_amount > 0
      and (
        (p_scope = 'all')
        or (
          p_scope = 'due_soon'
          and a.due_at <= now() + make_interval(days => v_lead)
        )
        or (
          p_scope = 'delinquent'
          and (
            a.status = 'delinquent'
            or now()::date > a.due_at::date
          )
        )
      )
      and (a.last_warning_at is null or a.last_warning_at::date < now()::date)
  loop
    update public.fiscal_tax_accounts
    set last_warning_at = now(),
        updated_at = now()
    where id = row_rec.id;

    insert into public.fiscal_tax_events (
      account_id, fiscal_year_id, user_id, event_type, detail, created_by
    ) values (
      row_rec.id, row_rec.fiscal_year_id, row_rec.user_id, 'warning',
      jsonb_build_object('scope', p_scope, 'outstanding', row_rec.outstanding_amount),
      v_uid
    );
    warned := warned + 1;
  end loop;

  return jsonb_build_object('ok', true, 'warned', warned);
end;
$$;

create or replace function public.fiscal_apply_tax_penalties()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  y record;
  row_rec record;
  v_today date := now()::date;
  from_day date;
  days_over int;
  penalty numeric;
  touched int := 0;
  v_rate numeric;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not public._fiscal_is_treasury_officer(v_uid) then
    raise exception 'Treasury authorization required.';
  end if;

  perform public._fiscal_treasury_bootstrap_tax_accounts_if_needed();

  select fy.* into y
  from public.rp_fiscal_years fy
  where exists (select 1 from public.fiscal_tax_accounts a where a.fiscal_year_id = fy.id)
  order by fy.year_index desc
  limit 1;
  if not found then return jsonb_build_object('ok', true, 'updated', 0); end if;

  v_rate := greatest(0.000001::numeric, coalesce(y.tax_penalty_daily_rate, 0.05::numeric));

  for row_rec in
    select *
    from public.fiscal_tax_accounts a
    where a.fiscal_year_id = y.id
      and a.outstanding_amount > 0
      and v_today > a.due_at::date
  loop
    from_day := coalesce(row_rec.penalty_applied_through_date + 1, row_rec.due_at::date + 1);
    days_over := greatest(0, (v_today - from_day + 1));
    if days_over <= 0 then
      continue;
    end if;

    penalty := round(row_rec.outstanding_amount * v_rate * days_over, 2);
    if penalty <= 0 then
      continue;
    end if;

    update public.fiscal_tax_accounts
    set total_penalties = total_penalties + penalty,
        outstanding_amount = outstanding_amount + penalty,
        status = 'delinquent',
        penalty_applied_through_date = v_today,
        updated_at = now()
    where id = row_rec.id;

    insert into public.fiscal_tax_events (
      account_id, fiscal_year_id, user_id, event_type, amount, detail, created_by
    ) values (
      row_rec.id, row_rec.fiscal_year_id, row_rec.user_id, 'penalty', penalty,
      jsonb_build_object('days', days_over, 'daily_rate', v_rate),
      v_uid
    );
    touched := touched + 1;
  end loop;

  return jsonb_build_object('ok', true, 'updated', touched);
end;
$$;

notify pgrst, 'reload schema';
