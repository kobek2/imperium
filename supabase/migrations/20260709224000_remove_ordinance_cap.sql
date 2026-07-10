-- Remove the 5-enacted-ordinance cap; signing no longer expires older laws.

create or replace function public.mayor_sign_ordinance(p_ordinance_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  p record;
  applied jsonb;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  if not exists (
    select 1 from public.government_role_grants g
    where g.user_id = v_uid and g.role_key in ('mayor', 'admin')
  ) and not public.is_staff_admin(v_uid) then
    raise exception 'Only the mayor may sign ordinances';
  end if;

  select * into p from public.city_ordinance_proposals where id = p_ordinance_id;
  if p.id is null then raise exception 'Ordinance proposal not found'; end if;
  if p.status <> 'awaiting_mayor' then raise exception 'Ordinance is not awaiting mayor signature'; end if;

  applied := public._apply_ordinance_effects(p_ordinance_id);

  update public.city_ordinance_proposals
  set status = 'enacted', enacted_at = now()
  where id = p_ordinance_id;

  return jsonb_build_object(
    'ok', true, 'status', 'enacted', 'ordinance_id', p_ordinance_id,
    'effects', applied->'effects', 'summary', applied->'summary'
  );
end;
$$;
