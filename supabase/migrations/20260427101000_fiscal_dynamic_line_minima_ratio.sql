-- Rework GDP-indexed line-minimum sync to be idempotent and less restrictive.
-- Previous behavior compounded minima on repeated runs and capped growth at +15%.

create or replace function public.fiscal_apply_server_gdp_inflation_to_line_minima()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  y record;
  b record;
  v_wallet_sum numeric;
  v_ratio numeric := 1;
  v_prev_ratio numeric := 1;
  v_items jsonb;
  v_out jsonb := '[]'::jsonb;
  v_base_min numeric;
  v_min numeric;
  v_alloc numeric;
  line_rec record;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not public._fiscal_is_president(v_uid) then
    raise exception 'Only the President may adjust draft line minima.';
  end if;

  select * into y from public.rp_fiscal_years where status = 'active' for update;
  if not found then raise exception 'No active fiscal year.'; end if;

  select * into b from public.federal_budgets where fiscal_year_id = y.id for update;
  if not found then raise exception 'No federal budget row for the active year.'; end if;
  if b.status is distinct from 'draft' then
    raise exception 'Line minima may only be inflated on a draft budget.';
  end if;

  select coalesce(sum(balance), 0) into v_wallet_sum from public.economy_wallets;

  if coalesce(y.gdp_opening_total, 0) > 0 then
    v_ratio := v_wallet_sum / y.gdp_opening_total;
    -- Keep floors non-decreasing and guard against runaway spikes.
    v_ratio := greatest(1::numeric, least(v_ratio, 4::numeric));
  end if;

  v_prev_ratio := greatest(
    1::numeric,
    coalesce(nullif((coalesce(b.metrics, '{}'::jsonb)->>'line_minima_gdp_ratio')::numeric, 0), 1::numeric)
  );

  v_items := coalesce(b.line_items, '[]'::jsonb);
  for line_rec in select * from jsonb_array_elements(v_items) as arr(elem)
  loop
    v_base_min := greatest(
      0::numeric,
      coalesce(
        (line_rec.elem->>'base_minimum')::numeric,
        (coalesce((line_rec.elem->>'minimum')::numeric, 0) / v_prev_ratio),
        (line_rec.elem->>'minimum')::numeric,
        0
      )
    );
    v_min := round(v_base_min * v_ratio, 2);
    v_alloc := greatest(coalesce((line_rec.elem->>'allocated')::numeric, 0), v_min);
    v_out := v_out || jsonb_build_array(
      line_rec.elem || jsonb_build_object(
        'base_minimum', v_base_min,
        'minimum', v_min,
        'allocated', v_alloc
      )
    );
  end loop;

  update public.federal_budgets
  set
    line_items = v_out,
    metrics = coalesce(metrics, '{}'::jsonb) || jsonb_build_object(
      'line_minima_gdp_ratio', round(v_ratio, 6),
      'line_minima_wallet_sum', round(v_wallet_sum, 2),
      'line_minima_updated_at', now()
    ),
    updated_at = now()
  where fiscal_year_id = y.id;

  return jsonb_build_object(
    'ok', true,
    'ratio_applied', round(v_ratio, 6),
    'previous_ratio', round(v_prev_ratio, 6),
    'wallet_sum', round(v_wallet_sum, 2)
  );
end;
$$;
