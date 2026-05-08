-- Guarantee: once an appropriations bill is enacted (status -> law),
-- floor minimums are immediately raised to enacted allocations.
-- This applies even if the bill bypasses app server actions.

create or replace function public._fiscal_sync_enacted_appropriations_floor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'law'
     and old.status is distinct from 'law'
     and coalesce(new.is_federal_appropriations, false)
  then
    perform public.fiscal_on_appropriations_enrolled(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_fiscal_sync_enacted_appropriations_floor on public.bills;
create trigger trg_fiscal_sync_enacted_appropriations_floor
after update of status on public.bills
for each row
execute function public._fiscal_sync_enacted_appropriations_floor();

-- Backfill safety for already-enrolled fiscal years:
-- ensure minimum/base_minimum are at least allocated on linked budget rows.
with enrolled as (
  select y.id as fiscal_year_id
  from public.rp_fiscal_years y
  where y.appropriations_act_bill_id is not null
),
normalized as (
  select
    fb.id,
    coalesce(
      (
        select jsonb_agg(
          coalesce(elem, '{}'::jsonb) || jsonb_build_object(
            'minimum',
            greatest(
              round(coalesce((elem->>'minimum')::numeric, 0), 2),
              round(coalesce((elem->>'allocated')::numeric, 0), 2)
            ),
            'base_minimum',
            greatest(
              round(
                coalesce(
                  case
                    when elem ? 'base_minimum' and elem->>'base_minimum' is not null and elem->>'base_minimum' <> ''
                    then (elem->>'base_minimum')::numeric
                    else null
                  end,
                  coalesce((elem->>'minimum')::numeric, 0)
                ),
                2
              ),
              round(coalesce((elem->>'allocated')::numeric, 0), 2)
            )
          )
          order by ord
        )
        from jsonb_array_elements(coalesce(fb.line_items, '[]'::jsonb)) with ordinality as t(elem, ord)
      ),
      '[]'::jsonb
    ) as line_items
  from public.federal_budgets fb
  join enrolled e on e.fiscal_year_id = fb.fiscal_year_id
)
update public.federal_budgets fb
set
  line_items = n.line_items,
  updated_at = now()
from normalized n
where fb.id = n.id;

notify pgrst, 'reload schema';
