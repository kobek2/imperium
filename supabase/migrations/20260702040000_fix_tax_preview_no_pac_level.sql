-- PAC passive income removed; tax preview should not reference economy_pacs.level.

create or replace function public.fiscal_estimate_ytd_income_tax()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_started timestamptz;
  v_hourly numeric;
  v_hourly_marginal_tax numeric;
  v_rp_year_gross numeric;
  v_brackets jsonb;
  v_tax numeric;
  v_fy_id uuid;
  v_rp_hours int := 72;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select y.id, y.started_at into v_fy_id, v_started
  from public.rp_fiscal_years y
  where y.status = 'active'
  limit 1;

  if v_fy_id is null then
    return jsonb_build_object(
      'fiscal_year_id', null,
      'gross_inflows', 0,
      'estimated_tax', 0,
      'fy_started_at', null,
      'scheduled_hourly_gross', 0,
      'rp_year_sim_hours', v_rp_hours
    );
  end if;

  select coalesce(b.tax_brackets, '[]'::jsonb) into v_brackets
  from public.federal_budgets b
  where b.fiscal_year_id = v_fy_id
  limit 1;

  v_hourly := public._economy_hourly_from_roles(public._economy_effective_role_keys(v_uid));

  v_hourly_marginal_tax := round(
    public.fiscal_marginal_tax(greatest(0::numeric, coalesce(v_hourly, 0)), v_brackets),
    6
  );
  v_tax := round(v_hourly_marginal_tax * v_rp_hours::numeric, 2);
  v_rp_year_gross := round(greatest(0::numeric, coalesce(v_hourly, 0)) * v_rp_hours::numeric, 2);

  return jsonb_build_object(
    'fiscal_year_id', v_fy_id,
    'fy_started_at', v_started,
    'gross_inflows', v_rp_year_gross,
    'estimated_tax', v_tax,
    'scheduled_hourly_gross', round(coalesce(v_hourly, 0), 2),
    'marginal_tax_on_one_scheduled_hour', round(v_hourly_marginal_tax, 2),
    'rp_year_sim_hours', v_rp_hours
  );
end;
$$;
