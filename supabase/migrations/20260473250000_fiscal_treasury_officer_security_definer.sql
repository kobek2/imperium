-- `_fiscal_is_treasury_officer` is invoked from SECURITY DEFINER fiscal RPCs. As SECURITY INVOKER it
-- evaluated nested `exists(... government_role_grants / profiles ...)` under the caller, which can
-- fail if RLS on those tables is tightened. Run the combined treasury check as definer instead.

create or replace function public._fiscal_is_treasury_officer(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public._fiscal_is_president(p_uid)
    or public._fiscal_is_admin(p_uid)
    or public.is_staff_admin(p_uid)
    or exists (
      select 1 from public.government_role_grants g
      where g.user_id = p_uid and g.role_key = 'secretary_of_treasury'
    )
    or exists (
      select 1 from public.profiles p
      where p.id = p_uid and p.office_role = 'secretary_of_treasury'
    ),
    false
  );
$$;

notify pgrst, 'reload schema';
