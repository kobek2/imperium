-- _fiscal_try_start_clock_on_president_grant() is attached to BOTH
-- government_role_grants (insert) and profiles (update). PostgreSQL does not
-- guarantee short-circuit evaluation of AND/OR, so referencing new.role_key in
-- the same expression as tg_table_name can still be evaluated when NEW is a
-- profiles row — causing: record "new" has no field "role_key".

create or replace function public._fiscal_try_start_clock_on_president_grant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'government_role_grants' then
    if (new).role_key = 'president' then
      perform public.fiscal_start_appropriation_clock_if_president_seated();
    end if;
  elsif tg_table_name = 'profiles' then
    if (new).office_role = 'president' and coalesce(old.office_role, '') <> 'president' then
      perform public.fiscal_start_appropriation_clock_if_president_seated();
    end if;
  end if;
  return new;
end;
$$;
