-- Normalize template stance labels to official naming style.
-- Replaces "+" shorthand with "and" across bill template stance labels.
with normalized as (
  select
    bt.id,
    jsonb_agg(
      jsonb_set(
        stance.elem,
        '{label}',
        to_jsonb(replace(replace(coalesce(stance.elem->>'label', ''), ' + ', ' and '), '+', ' and '))
      )
      order by stance.ord
    ) as stances
  from public.bill_templates bt
  cross join lateral jsonb_array_elements(bt.stances) with ordinality as stance(elem, ord)
  group by bt.id
)
update public.bill_templates bt
set stances = normalized.stances
from normalized
where bt.id = normalized.id;
