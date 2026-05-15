-- Illustrative military power scoreboard (ground / air / naval) for RP comparison.
-- U.S. player-controlled totals live in rp_cabinet_department_metrics (defense body); peers live here.

alter table public.rp_foreign_nations
  add column if not exists power_ground integer not null default 0 check (power_ground >= 0 and power_ground <= 20000),
  add column if not exists power_air integer not null default 0 check (power_air >= 0 and power_air <= 20000),
  add column if not exists power_naval integer not null default 0 check (power_naval >= 0 and power_naval <= 20000);

comment on column public.rp_foreign_nations.power_ground is 'Baseline illustrative ground power for scoreboard only.';
comment on column public.rp_foreign_nations.power_air is 'Baseline illustrative air power for scoreboard only.';
comment on column public.rp_foreign_nations.power_naval is 'Baseline illustrative naval power for scoreboard only.';

-- Belt + major powers: rough orders-of-magnitude vs a ~500-point U.S. starting posture in the sim.
update public.rp_foreign_nations set power_ground = 190, power_air = 170, power_naval = 120 where code = 'CHN';
update public.rp_foreign_nations set power_ground = 110, power_air = 95, power_naval = 105 where code = 'RUS';
update public.rp_foreign_nations set power_ground = 45, power_air = 35, power_naval = 25 where code = 'IRN';
update public.rp_foreign_nations set power_ground = 8, power_air = 15, power_naval = 22 where code = 'TWN';
update public.rp_foreign_nations set power_ground = 75, power_air = 30, power_naval = 10 where code = 'UKR';
update public.rp_foreign_nations set power_ground = 42, power_air = 48, power_naval = 55 where code = 'KOR';
update public.rp_foreign_nations set power_ground = 28, power_air = 55, power_naval = 15 where code = 'ISR';

-- Other roster rows: modest defaults so selects stay non-null.
update public.rp_foreign_nations
set power_ground = greatest(power_ground, 18), power_air = greatest(power_air, 14), power_naval = greatest(power_naval, 12)
where power_ground = 0 and power_air = 0 and power_naval = 0;
