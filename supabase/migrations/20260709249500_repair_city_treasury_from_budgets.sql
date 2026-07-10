-- Repair treasury after macro-revenue bug: recalculate enacted budget balances, then rebuild treasury.

do $$
declare
  b record;
  rev numeric;
  exp numeric;
  total_def numeric := 0;
begin
  rev := public._city_biennial_fiscal_revenue_millions('MB');

  for b in
    select id
    from public.city_budgets
    where status = 'enacted'
    order by fiscal_year, enacted_at nulls last, created_at
  loop
    select coalesce(sum(amount_millions), 0) into exp
    from public.city_budget_lines
    where budget_id = b.id;

    update public.city_budgets
    set
      projected_revenue_millions = rev,
      projected_expenditure_millions = exp,
      projected_deficit_millions = rev - exp
    where id = b.id;

    total_def := total_def + (rev - exp);
  end loop;

  update public.city_fiscal_metrics
  set treasury_balance = total_def,
      updated_at = now()
  where city_code = 'MB';
end;
$$;

notify pgrst, 'reload schema';
