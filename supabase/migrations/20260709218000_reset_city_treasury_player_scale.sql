-- Reset city treasury to player-scale; remove stale council grants (solo mayor test).

update public.city_fiscal_metrics
set
  treasury_balance = 0.05,
  updated_at = now()
where city_code = 'MB';

-- Rescale department draft to ~$61K annual revenue (1 mayor × $750K salaries × ~3% tax).
update public.city_fiscal_department_allocations
set amount_millions = case department_key
  when 'finance' then 0.005
  when 'police' then 0.021
  when 'public_works' then 0.017
  when 'parks' then 0.011
  when 'planning' then 0.007
  else amount_millions
end
where city_code = 'MB';

delete from public.government_role_grants g
where g.role_key = 'council_member'
  and g.user_id in (
    select p.id from public.profiles p
    where p.character_name in ('Elizabeth McCord', 'Alexandria Ocasio-Cortez')
  );

delete from public.city_office_salary_ledger l
where l.role_key = 'council_member'
  and l.user_id in (
    select p.id from public.profiles p
    where p.character_name in ('Elizabeth McCord', 'Alexandria Ocasio-Cortez')
  );

do $$
begin
  perform public._sync_city_office_salary_pool_column('MB');
end;
$$;

notify pgrst, 'reload schema';
