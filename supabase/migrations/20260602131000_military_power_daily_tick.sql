-- Daily passive bump for military power scoreboard (+10 total index points per UTC day: +4 ground, +3 air, +3 naval).
-- Idempotent via rp_daily_counters so cabinet page loads do not stack multiple times the same day.

create table if not exists public.rp_daily_counters (
  key text primary key,
  last_day date not null
);

insert into public.rp_daily_counters (key, last_day)
values ('military_power', '1970-01-01'::date)
on conflict (key) do nothing;

comment on table public.rp_daily_counters is 'Single-row style UTC-day gates for idempotent daily sim ticks.';

create or replace function public.rp_military_power_daily_tick(p_today date default (timezone('UTC', now()))::date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  update public.rp_daily_counters
  set last_day = p_today
  where key = 'military_power'
    and last_day < p_today;

  get diagnostics v_n = row_count;

  if v_n = 0 then
    return;
  end if;

  update public.rp_foreign_nations
  set
    power_ground = least(20000, power_ground + 4),
    power_air = least(20000, power_air + 3),
    power_naval = least(20000, power_naval + 3),
    updated_at = now();

  update public.rp_cabinet_department_metrics
  set
    body =
      coalesce(body, '{}'::jsonb)
      || jsonb_build_object(
        'military_power_ground',
        least(
          20000,
          greatest(
            0,
            coalesce(nullif(body->>'military_power_ground', '')::int, 100) + 4
          )
        ),
        'military_power_air',
        least(
          20000,
          greatest(
            0,
            coalesce(nullif(body->>'military_power_air', '')::int, 200) + 3
          )
        ),
        'military_power_naval',
        least(
          20000,
          greatest(
            0,
            coalesce(nullif(body->>'military_power_naval', '')::int, 200) + 3
          )
        )
      ),
    updated_at = now()
  where portfolio_key = 'defense';
end;
$$;

comment on function public.rp_military_power_daily_tick(date) is
  'Once per UTC calendar day: +4/+3/+3 military power on every rp_foreign_nations row and defense portfolio body (defaults 100/200/200 when keys absent).';

revoke all on function public.rp_military_power_daily_tick(date) from public;
grant execute on function public.rp_military_power_daily_tick(date) to authenticated;
grant execute on function public.rp_military_power_daily_tick(date) to service_role;
