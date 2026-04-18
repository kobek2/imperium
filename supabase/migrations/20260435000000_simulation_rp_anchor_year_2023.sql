-- RP narrative starts at calendar year 2023 on the anchor date (aligns product default with app fallbacks).
alter table public.simulation_settings
  alter column rp_anchor_date set default date '2023-01-01';

update public.simulation_settings
set rp_anchor_date = date '2023-01-01'
where id = 1
  and rp_anchor_date = date '2024-01-01';
