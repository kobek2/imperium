-- When an appropriations act is enrolled, raise each budget line's minimum (and base_minimum) to at least
-- the appropriated amount for that line so the next cycle cannot go below the last enacted level.

create or replace function public.fiscal_on_appropriations_enrolled(p_bill_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  b record;
  y record;
  new_line_items jsonb;
begin
  if p_bill_id is null then
    raise exception 'Bill id required.';
  end if;

  select * into b from public.bills where id = p_bill_id;
  if not found then
    raise exception 'Bill not found.';
  end if;
  if b.status is distinct from 'law' then
    raise exception 'Bill is not enrolled as law.';
  end if;
  if not coalesce(b.is_federal_appropriations, false) then
    return jsonb_build_object('ok', true, 'skipped', true);
  end if;
  if b.linked_fiscal_year_id is null then
    raise exception 'Appropriations bill is not linked to a fiscal year.';
  end if;

  select * into y from public.rp_fiscal_years where id = b.linked_fiscal_year_id for update;
  if not found then
    raise exception 'Fiscal year not found.';
  end if;

  if y.appropriations_act_bill_id is not null and y.appropriations_act_bill_id is distinct from p_bill_id then
    raise exception 'This fiscal year already has an enrolled appropriations act.';
  end if;

  update public.rp_fiscal_years
  set appropriations_act_bill_id = p_bill_id
  where id = y.id;

  if exists (
    select 1
    from public.federal_budgets fb
    where fb.fiscal_year_id = y.id
      and coalesce(jsonb_array_length(fb.line_items), 0) > 0
  ) then
    select coalesce(
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
          order by t.ord
        )
        from jsonb_array_elements(
          (select fb.line_items from public.federal_budgets fb where fb.fiscal_year_id = y.id limit 1)
        ) with ordinality as t(elem, ord)
      ),
      '[]'::jsonb
    )
    into new_line_items;

    update public.federal_budgets
    set
      status = 'submitted',
      submitted_at = coalesce(submitted_at, now()),
      line_items = new_line_items,
      updated_at = now()
    where fiscal_year_id = y.id;
  else
    update public.federal_budgets
    set
      status = 'submitted',
      submitted_at = coalesce(submitted_at, now()),
      updated_at = now()
    where fiscal_year_id = y.id;
  end if;

  return jsonb_build_object('ok', true, 'fiscal_year_id', y.id, 'bill_id', p_bill_id);
end;
$$;

notify pgrst, 'reload schema';
