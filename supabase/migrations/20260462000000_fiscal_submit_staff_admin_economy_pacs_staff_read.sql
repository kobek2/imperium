-- Allow full staff operators to submit the federal budget (unlock economy) when the President
-- no longer has a dedicated submit button (Congress workflow). President path unchanged.
-- Also allow staff admins to read all PAC rows for economy oversight.

create or replace function public.fiscal_submit_budget(p_fiscal_year_id uuid)
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
  el jsonb;
  min_amt numeric;
  alloc numeric;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not (
    public._fiscal_is_president(v_uid)
    or public.is_staff_admin(v_uid)
  ) then
    raise exception 'Only the President or a full staff operator may submit the federal budget.';
  end if;

  select * into y from public.rp_fiscal_years where id = p_fiscal_year_id for update;
  if not found then raise exception 'Fiscal year not found'; end if;
  if y.status is distinct from 'active' then raise exception 'Only the active fiscal year can be submitted.'; end if;

  select * into b from public.federal_budgets where fiscal_year_id = p_fiscal_year_id for update;
  if not found then raise exception 'No budget draft exists. Save a draft first.'; end if;
  if b.status = 'submitted' then raise exception 'Budget already submitted.'; end if;

  for el in select * from jsonb_array_elements(b.line_items)
  loop
    min_amt := coalesce((el->>'minimum')::numeric, 0);
    alloc := coalesce((el->>'allocated')::numeric, 0);
    if alloc < min_amt then
      raise exception 'Line item % requires at least $% allocated (got $%).', el->>'key', min_amt, alloc;
    end if;
  end loop;

  update public.federal_budgets
  set status = 'submitted', submitted_at = now(), president_user_id = coalesce(b.president_user_id, v_uid), updated_at = now()
  where id = b.id;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.is_staff_economy_auditor(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_staff_admin(uid)
  or exists (
    select 1 from public.government_role_grants g
    where g.user_id = uid and g.role_key = 'staff_economy'
  );
$$;

comment on function public.is_staff_economy_auditor(uuid) is
  'True for full staff operators or staff_economy — used for read-all economy_pacs audit policy.';

drop policy if exists "economy_pacs read own" on public.economy_pacs;

create policy "economy_pacs select own or staff audit"
  on public.economy_pacs
  for select
  to authenticated
  using (
    auth.uid() = user_id
    or public.is_staff_economy_auditor(auth.uid())
  );

-- Sim national debt is not tied to player wallets; keep published rows at zero.
update public.national_metrics set us_debt = 0 where coalesce(us_debt, 0) <> 0;
