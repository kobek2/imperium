-- FY1 staff reset: keep existing federal_budgets tax_brackets / line_items / metrics / status;
-- seed defaults only when no budget row exists for FY1.

create or replace function public.admin_fiscal_reset_restore_fy1(
  p_extra_us_debt numeric default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  fy1 record;
  r record;
  v_refund numeric;
  v_bal numeric;
  v_treasury_pull numeric := 0;
  v_fy1_id uuid;
  v_tax_from_close numeric := 0;
  v_debt_bump numeric := 0;
  v_seed_brackets jsonb :=
    '[
      {"ceiling":20000,"rate":0},
      {"ceiling":50000,"rate":0.025},
      {"ceiling":100000,"rate":0.05},
      {"ceiling":200000,"rate":0.15},
      {"ceiling":null,"rate":0.405}
    ]'::jsonb;
  v_seed_lines jsonb :=
    '[
      {"key":"infrastructure","label":"Infrastructure and Transportation","minimum":600000,"allocated":600000},
      {"key":"education","label":"Education","minimum":500000,"allocated":500000},
      {"key":"healthcare","label":"Healthcare","minimum":700000,"allocated":700000},
      {"key":"defense","label":"Defense and National Security","minimum":650000,"allocated":650000},
      {"key":"social_welfare","label":"Social Welfare Programs","minimum":450000,"allocated":450000},
      {"key":"environment","label":"Environmental Protection","minimum":200000,"allocated":200000},
      {"key":"economic_development","label":"Economic Development and Job Creation","minimum":600000,"allocated":600000},
      {"key":"science_tech","label":"Science and Technology Research","minimum":200000,"allocated":200000},
      {"key":"foreign_aid","label":"Foreign Aid and Diplomacy","minimum":100000,"allocated":100000},
      {"key":"relief","label":"Relief Funds","minimum":100000,"allocated":100000}
    ]'::jsonb;
begin
  if v_uid is null or not public.is_staff_admin(v_uid) then
    raise exception 'Only staff admins may run fiscal simulation reset.';
  end if;

  select * into fy1 from public.rp_fiscal_years where year_index = 1 order by started_at asc limit 1 for update;
  if not found then
    raise exception 'FY 1 (year_index = 1) does not exist.';
  end if;

  v_fy1_id := fy1.id;

  select coalesce(s.tax_collected_total, 0) into v_tax_from_close
  from public.fiscal_year_close_summaries s
  where s.fiscal_year_id = v_fy1_id;

  for r in
    select wallet_user_id, sum(delta)::numeric as dsum
    from public.economy_ledger
    where kind = 'fiscal_income_tax'
      and coalesce(detail->>'fiscal_year_id', '') = v_fy1_id::text
    group by wallet_user_id
  loop
    v_refund := round(-coalesce(r.dsum, 0), 2);
    if v_refund <= 0 then
      continue;
    end if;

    v_treasury_pull := v_treasury_pull + v_refund;

    insert into public.economy_wallets (user_id, balance, updated_at)
    values (r.wallet_user_id, 0, now())
    on conflict (user_id) do nothing;

    update public.economy_wallets
    set balance = balance + v_refund, updated_at = now()
    where user_id = r.wallet_user_id
    returning balance into v_bal;

    insert into public.economy_ledger (wallet_user_id, delta, balance_after, kind, detail)
    values (
      r.wallet_user_id,
      v_refund,
      coalesce(v_bal, v_refund),
      'fiscal_income_tax_refund',
      jsonb_build_object(
        'fiscal_year_id', v_fy1_id,
        'reason', 'admin_fiscal_reset_restore_fy1'
      )
    );
  end loop;

  if v_treasury_pull > 0 then
    update public.federal_treasury
    set balance = greatest(0::numeric, balance - v_treasury_pull)
    where id = 1;
  end if;

  delete from public.fiscal_tax_accounts where fiscal_year_id = v_fy1_id;
  delete from public.fiscal_tax_settlements where fiscal_year_id = v_fy1_id;
  delete from public.fiscal_year_close_summaries where fiscal_year_id = v_fy1_id;

  delete from public.rp_fiscal_years where year_index > 1;

  update public.rp_fiscal_years
  set
    status = 'active',
    closed_at = null,
    gdp_closing_total = null,
    appropriations_act_bill_id = null,
    economy_activity_frozen = false,
    appropriation_deadline_at = now() + interval '24 hours',
    appropriation_clock_started_at = now()
  where id = v_fy1_id;

  insert into public.federal_budgets (
    fiscal_year_id,
    status,
    submitted_at,
    president_user_id,
    tax_brackets,
    line_items,
    metrics,
    updated_at
  )
  select
    v_fy1_id,
    'submitted',
    now(),
    v_uid,
    v_seed_brackets,
    v_seed_lines,
    '{}'::jsonb,
    now()
  where not exists (select 1 from public.federal_budgets b where b.fiscal_year_id = v_fy1_id);

  update public.federal_budgets
  set updated_at = now()
  where fiscal_year_id = v_fy1_id;

  v_debt_bump := coalesce(v_tax_from_close, 0) + coalesce(p_extra_us_debt, 0);
  if v_debt_bump > 0 then
    insert into public.national_metrics (fiscal_year_id, us_debt, updated_by)
    values (v_fy1_id, v_debt_bump, v_uid)
    on conflict (fiscal_year_id) do update
    set
      us_debt = coalesce(public.national_metrics.us_debt, 0) + excluded.us_debt,
      updated_at = now(),
      updated_by = excluded.updated_by;
  end if;

  return jsonb_build_object(
    'ok', true,
    'fy1_id', v_fy1_id,
    'refunded_from_treasury', v_treasury_pull,
    'tax_booked_to_debt', coalesce(v_tax_from_close, 0),
    'extra_debt_added', coalesce(p_extra_us_debt, 0)
  );
end;
$$;

grant execute on function public.admin_fiscal_reset_restore_fy1(numeric) to authenticated;

notify pgrst, 'reload schema';
