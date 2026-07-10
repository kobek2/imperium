-- Wage income tax revenue was always $0: income_tax_enabled defaulted false while brackets were seeded.

update public.city_fiscal_metrics
set
  income_tax_enabled = true,
  income_tax_low_pct = case when income_tax_low_pct <= 0 then 2.0 else income_tax_low_pct end,
  income_tax_mid_pct = case when income_tax_mid_pct <= 0 then 3.5 else income_tax_mid_pct end,
  income_tax_high_pct = case when income_tax_high_pct <= 0 then 4.5 else income_tax_high_pct end,
  updated_at = now()
where city_code = 'MB';

create or replace function public.is_city_mayor_or_admin(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.government_role_grants g
    where g.user_id = p_uid and g.role_key in ('mayor', 'admin')
  ) or public.is_staff_admin(p_uid);
$$;

notify pgrst, 'reload schema';
