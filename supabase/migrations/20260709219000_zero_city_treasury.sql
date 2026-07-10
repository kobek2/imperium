-- City treasury starts at zero; enacted budgets apply surplus/deficit each FY.

update public.city_fiscal_metrics
set treasury_balance = 0, updated_at = now()
where city_code = 'MB';

notify pgrst, 'reload schema';
