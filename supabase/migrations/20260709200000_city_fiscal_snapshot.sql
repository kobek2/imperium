-- City fiscal snapshot: macro metrics, tax policy draft, and department allocation planning.

create table if not exists public.city_fiscal_metrics (
  city_code char(2) primary key references public.cities (code) on delete cascade,
  population bigint not null default 0 check (population >= 0),
  avg_household_income numeric not null default 0 check (avg_household_income >= 0),
  economy_index numeric not null default 0 check (economy_index >= 0),
  property_tax_rate_pct numeric not null default 0 check (property_tax_rate_pct >= 0),
  income_tax_enabled boolean not null default false,
  income_tax_low_pct numeric not null default 0 check (income_tax_low_pct >= 0),
  income_tax_mid_pct numeric not null default 0 check (income_tax_mid_pct >= 0),
  income_tax_high_pct numeric not null default 0 check (income_tax_high_pct >= 0),
  treasury_balance numeric not null default 0,
  fiscal_year smallint not null default 1 check (fiscal_year >= 1),
  updated_at timestamptz not null default now()
);

create table if not exists public.city_fiscal_department_allocations (
  city_code char(2) not null references public.cities (code) on delete cascade,
  department_key text not null check (department_key in (
    'finance', 'police', 'public_works', 'parks', 'planning'
  )),
  amount_millions numeric not null default 0 check (amount_millions >= 0),
  primary key (city_code, department_key)
);

alter table public.city_fiscal_metrics enable row level security;
alter table public.city_fiscal_department_allocations enable row level security;

drop policy if exists "city_fiscal_metrics read" on public.city_fiscal_metrics;
create policy "city_fiscal_metrics read" on public.city_fiscal_metrics
  for select to authenticated using (true);

drop policy if exists "city_fiscal_department_allocations read" on public.city_fiscal_department_allocations;
create policy "city_fiscal_department_allocations read" on public.city_fiscal_department_allocations
  for select to authenticated using (true);

insert into public.city_fiscal_metrics (city_code) values ('MB')
on conflict (city_code) do nothing;

insert into public.city_fiscal_department_allocations (city_code, department_key, amount_millions) values
  ('MB', 'finance', 0),
  ('MB', 'police', 0),
  ('MB', 'public_works', 0),
  ('MB', 'parks', 0),
  ('MB', 'planning', 0)
on conflict (city_code, department_key) do nothing;

create or replace function public.get_city_fiscal_snapshot(p_city_code char(2) default 'MB')
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  m record;
  depts jsonb;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into m from public.city_fiscal_metrics where city_code = p_city_code;
  if m.city_code is null then
    raise exception 'City fiscal metrics not found for %', p_city_code;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'department_key', d.department_key,
        'amount_millions', d.amount_millions
      )
      order by d.department_key
    ),
    '[]'::jsonb
  ) into depts
  from public.city_fiscal_department_allocations d
  where d.city_code = p_city_code;

  return jsonb_build_object(
    'city_code', m.city_code,
    'population', m.population,
    'avg_household_income', m.avg_household_income,
    'economy_index', m.economy_index,
    'property_tax_rate_pct', m.property_tax_rate_pct,
    'income_tax_enabled', m.income_tax_enabled,
    'income_tax_low_pct', m.income_tax_low_pct,
    'income_tax_mid_pct', m.income_tax_mid_pct,
    'income_tax_high_pct', m.income_tax_high_pct,
    'treasury_balance', m.treasury_balance,
    'fiscal_year', m.fiscal_year,
    'updated_at', m.updated_at,
    'departments', depts
  );
end;
$$;

create or replace function public.mayor_update_fiscal_proposal(
  p_city_code char(2) default 'MB',
  p_property_tax_rate_pct numeric default null,
  p_income_tax_enabled boolean default null,
  p_income_tax_low_pct numeric default null,
  p_income_tax_mid_pct numeric default null,
  p_income_tax_high_pct numeric default null,
  p_finance numeric default null,
  p_police numeric default null,
  p_public_works numeric default null,
  p_parks numeric default null,
  p_planning numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  if not exists (
    select 1 from public.government_role_grants g
    where g.user_id = v_uid and g.role_key in ('mayor', 'admin')
  ) and not public.is_staff_admin(v_uid) then
    raise exception 'Only the mayor may update the fiscal proposal';
  end if;

  update public.city_fiscal_metrics set
    property_tax_rate_pct = coalesce(p_property_tax_rate_pct, property_tax_rate_pct),
    income_tax_enabled = coalesce(p_income_tax_enabled, income_tax_enabled),
    income_tax_low_pct = coalesce(p_income_tax_low_pct, income_tax_low_pct),
    income_tax_mid_pct = coalesce(p_income_tax_mid_pct, income_tax_mid_pct),
    income_tax_high_pct = coalesce(p_income_tax_high_pct, income_tax_high_pct),
    updated_at = now()
  where city_code = p_city_code;

  if p_finance is not null then
    update public.city_fiscal_department_allocations
    set amount_millions = greatest(coalesce(p_finance, 0), 0)
    where city_code = p_city_code and department_key = 'finance';
  end if;
  if p_police is not null then
    update public.city_fiscal_department_allocations
    set amount_millions = greatest(coalesce(p_police, 0), 0)
    where city_code = p_city_code and department_key = 'police';
  end if;
  if p_public_works is not null then
    update public.city_fiscal_department_allocations
    set amount_millions = greatest(coalesce(p_public_works, 0), 0)
    where city_code = p_city_code and department_key = 'public_works';
  end if;
  if p_parks is not null then
    update public.city_fiscal_department_allocations
    set amount_millions = greatest(coalesce(p_parks, 0), 0)
    where city_code = p_city_code and department_key = 'parks';
  end if;
  if p_planning is not null then
    update public.city_fiscal_department_allocations
    set amount_millions = greatest(coalesce(p_planning, 0), 0)
    where city_code = p_city_code and department_key = 'planning';
  end if;

  return public.get_city_fiscal_snapshot(p_city_code);
end;
$$;

grant execute on function public.get_city_fiscal_snapshot(char) to authenticated;
grant execute on function public.mayor_update_fiscal_proposal(
  char, numeric, boolean, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric
) to authenticated;
