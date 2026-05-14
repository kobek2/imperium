-- RP v2 baseline: January 2032 at migration apply time (matches web RP_START_YEAR / RP_START_MONTH in
-- `web/src/lib/simulation-calendar-constants.ts`).
-- Aligns `public.simulation_rp_calendar_date()` v2 branch with the same constants.

update public.simulation_settings
set
  simulation_start_at = now(),
  calendar_is_active = true,
  calendar_seat_cycle_freeze_rp_year = null,
  calendar_seat_cycle_freeze_rp_month = null,
  updated_at = now()
where id = 1;

update public.bills
set policy_congress_cycle_start_year = 2032
where coalesce(policy_congress_cycle_start_year, 2029) = 2029;

create or replace function public.simulation_rp_calendar_date()
returns date
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  cfg record;
  anchor_ts timestamptz;
  elapsed_days numeric;
  pace numeric;
  float_months numeric;
  whole int;
  frac numeric;
  after_whole timestamptz;
  at_ts timestamptz;
  v_start timestamptz;
  v_rp_months numeric;
  v_total numeric;
  v_year int;
  v_month int;
begin
  select
    calendar_is_active,
    simulation_start_at,
    rp_anchor_date,
    real_anchor_at,
    rp_months_per_real_day
  into cfg
  from public.simulation_settings
  where id = 1;

  if not found then
    return (timezone('UTC', now()))::date;
  end if;

  if coalesce(cfg.calendar_is_active, false) and cfg.simulation_start_at is not null then
    v_start := cfg.simulation_start_at;
    v_rp_months := public._rp_months_per_real_day_fixed();
    elapsed_days := extract(epoch from (now() - v_start)) / 86400.0;
    float_months := elapsed_days * v_rp_months;
    v_total := (2032 - 1) * 12 + (1 - 1) + float_months;
    v_year := floor(v_total / 12)::int + 1;
    v_month := (floor(v_total)::int % 12) + 1;
    return make_date(v_year, greatest(1, least(12, v_month)), 1);
  end if;

  anchor_ts := make_timestamptz(
    extract(year from cfg.rp_anchor_date)::int,
    extract(month from cfg.rp_anchor_date)::int,
    extract(day from cfg.rp_anchor_date)::int,
    12,
    0,
    0,
    'UTC'
  );

  elapsed_days := extract(epoch from (now() - cfg.real_anchor_at)) / 86400.0;
  pace := coalesce(cfg.rp_months_per_real_day, 3.5);
  float_months := elapsed_days * pace;
  whole := floor(float_months)::int;
  frac := float_months - whole;

  after_whole := anchor_ts + make_interval(months => whole);
  at_ts := after_whole + (frac * 30.436875) * interval '1 day';

  return (timezone('UTC', at_ts))::date;
end;
$$;

notify pgrst, 'reload schema';
