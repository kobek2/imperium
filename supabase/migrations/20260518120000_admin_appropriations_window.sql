-- Admin-driven appropriations window: no automatic deadline on new active FY rows.
-- Staff start the IRL countdown via admin_start_appropriations_window().
-- President-seated auto clock becomes a no-op (staff must start the window).

create or replace function public._fiscal_seed_active_year_window()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Previously auto-seeded appropriation_deadline_at on activation. Deadlines are staff-controlled now.
  return new;
end;
$$;

create or replace function public.fiscal_start_appropriation_clock_if_president_seated()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  perform public.fiscal_sync_budget_cycle_with_simulation();
  return jsonb_build_object(
    'ok', true,
    'started', false,
    'reason', 'staff_must_start_appropriations_window',
    'hint', 'Use Admin → Economy overview → Start appropriations countdown.'
  );
end;
$$;

create or replace function public.admin_start_appropriations_window(p_hours int default 24)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  y record;
  v_hours int;
  v_now timestamptz := now();
  v_deadline timestamptz;
begin
  if v_uid is null or not public.is_staff_admin(v_uid) then
    raise exception 'Only staff administrators may start the appropriations countdown.';
  end if;

  v_hours := greatest(1, least(coalesce(p_hours, 24), 168));

  select * into y
  from public.rp_fiscal_years
  where status = 'active'
  for update;

  if not found then
    raise exception 'No active fiscal year.';
  end if;

  if y.appropriations_act_bill_id is not null then
    return jsonb_build_object('ok', false, 'message', 'An appropriations act is already enrolled for this fiscal year.');
  end if;

  v_deadline := v_now + make_interval(hours => v_hours);

  update public.rp_fiscal_years
  set
    appropriation_clock_started_at = v_now,
    appropriation_deadline_at = v_deadline,
    budget_initial_window_ends_at = v_deadline,
    budget_initial_window_missed_at = null,
    appropriation_window_hours = v_hours
  where id = y.id;

  return jsonb_build_object(
    'ok', true,
    'fiscal_year_id', y.id,
    'appropriation_deadline_at', v_deadline,
    'hours', v_hours
  );
end;
$$;

grant execute on function public.admin_start_appropriations_window(int) to authenticated;

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

  perform public._economy_require_active_budget();

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

  perform public._economy_require_active_budget();

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
