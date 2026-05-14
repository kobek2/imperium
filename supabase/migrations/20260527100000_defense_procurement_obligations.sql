-- Defense procurement obligations: obligate against the active FY federal budget "defense" line allocation
-- (abstract RP accounting; does not move treasury wallets).

create table if not exists public.rp_defense_procurement_obligations (
  id uuid primary key default gen_random_uuid(),
  fiscal_year_id uuid not null references public.rp_fiscal_years (id) on delete cascade,
  category text not null check (
    category in (
      'weapon_system_modernization',
      'heavy_armor',
      'cavalry_and_mobility',
      'aviation_rotary',
      'missiles_and_long_range_strike',
      'munitions_industrial_base'
    )
  ),
  amount_obligated numeric(20, 2) not null check (amount_obligated > 0),
  memo text not null default '' check (char_length(memo) <= 2000),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.rp_defense_procurement_obligations is
  'Secretary of Defense obligates defense line appropriations toward modernization / platforms (RP; capped by federal_budgets defense allocated).';

create index if not exists rp_defense_proc_obligations_fy_created_idx
  on public.rp_defense_procurement_obligations (fiscal_year_id, created_at desc);

alter table public.rp_defense_procurement_obligations enable row level security;

drop policy if exists "rp_defense_proc_obligations read cabinet" on public.rp_defense_procurement_obligations;
create policy "rp_defense_proc_obligations read cabinet"
  on public.rp_defense_procurement_obligations for select
  to authenticated
  using (public._cabinet_portfolio_viewer(auth.uid()));

drop policy if exists "rp_defense_proc_obligations insert secretary" on public.rp_defense_procurement_obligations;
create policy "rp_defense_proc_obligations insert secretary"
  on public.rp_defense_procurement_obligations for insert
  to authenticated
  with check (public._cabinet_portfolio_secretary(auth.uid(), 'secretary_of_defense'));

-- Atomic cap vs defense line (requires submitted federal budget for the FY).
create or replace function public.rp_defense_obligate_procurement(
  p_fiscal_year_id uuid,
  p_category text,
  p_amount numeric,
  p_memo text default ''
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_budget record;
  v_allocated numeric;
  v_used numeric;
  v_new_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if not public._cabinet_portfolio_secretary(v_uid, 'secretary_of_defense') then
    raise exception 'Only the Secretary of Defense may obligate defense procurement funds.';
  end if;

  if p_fiscal_year_id is null then
    raise exception 'Fiscal year required.';
  end if;

  if p_category not in (
    'weapon_system_modernization',
    'heavy_armor',
    'cavalry_and_mobility',
    'aviation_rotary',
    'missiles_and_long_range_strike',
    'munitions_industrial_base'
  ) then
    raise exception 'Invalid procurement category.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be positive.';
  end if;

  if coalesce(trim(p_memo), '') = '' then
    p_memo := '';
  end if;
  if char_length(p_memo) > 2000 then
    raise exception 'Memo too long.';
  end if;

  select * into v_budget
  from public.federal_budgets b
  where b.fiscal_year_id = p_fiscal_year_id
  for update;

  if not found then
    raise exception 'No federal budget row exists for this fiscal year.';
  end if;

  if v_budget.status is distinct from 'submitted' then
    raise exception 'Federal budget must be submitted before obligating defense funds.';
  end if;

  select coalesce(max((elem->>'allocated')::numeric), 0::numeric) into v_allocated
  from jsonb_array_elements(coalesce(v_budget.line_items, '[]'::jsonb)) elem
  where elem->>'key' = 'defense';

  if v_allocated <= 0 then
    raise exception 'Defense line allocation is zero or missing from the federal budget.';
  end if;

  select coalesce(sum(o.amount_obligated), 0::numeric) into v_used
  from public.rp_defense_procurement_obligations o
  where o.fiscal_year_id = p_fiscal_year_id;

  if v_used + p_amount > v_allocated then
    raise exception
      'INSUFFICIENT_DEFENSE_APPROPRIATION: total obligations would exceed the defense line allocation for this fiscal year.';
  end if;

  insert into public.rp_defense_procurement_obligations (
    fiscal_year_id,
    category,
    amount_obligated,
    memo,
    created_by
  )
  values (
    p_fiscal_year_id,
    p_category,
    p_amount,
    coalesce(p_memo, ''),
    v_uid
  )
  returning id into v_new_id;

  return jsonb_build_object(
    'ok', true,
    'id', v_new_id,
    'obligated_total', v_used + p_amount,
    'defense_line_cap', v_allocated
  );
end;
$$;

revoke all on function public.rp_defense_obligate_procurement(uuid, text, numeric, text) from public;
grant execute on function public.rp_defense_obligate_procurement(uuid, text, numeric, text) to authenticated;

notify pgrst, 'reload schema';
