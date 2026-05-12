-- Federal budget bracket preview: use scheduled hourly_income gross (role + PAC), not wallet balances.
-- SECURITY DEFINER so Treasury/President can read PAC tiers for all profiles (RLS otherwise hides other users' PAC rows).

create or replace function public.fiscal_list_player_scheduled_hourly_gross()
returns table(user_id uuid, hourly_gross numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;
  if not public._fiscal_is_treasury_officer(v_caller) then
    raise exception 'Only the President, Treasury leadership, or a full staff operator may load federal tax base previews.';
  end if;

  return query
  select
    p.id as user_id,
    (
      public._economy_hourly_from_roles(public._economy_effective_role_keys(p.id))
      + coalesce(
          (
            select public._economy_pac_hourly(e.level)
            from public.economy_pacs e
            where e.user_id = p.id
            limit 1
          ),
          0::numeric
        )
    )::numeric as hourly_gross
  from public.profiles p;
end;
$$;

comment on function public.fiscal_list_player_scheduled_hourly_gross() is
  'Returns each profile''s scheduled hourly_income gross (government role rate + PAC tier), matching economy_collect_income before the hours multiplier. Used for federal marginal-bracket previews.';

revoke all on function public.fiscal_list_player_scheduled_hourly_gross() from public;
grant execute on function public.fiscal_list_player_scheduled_hourly_gross() to authenticated;
grant execute on function public.fiscal_list_player_scheduled_hourly_gross() to service_role;

notify pgrst, 'reload schema';
