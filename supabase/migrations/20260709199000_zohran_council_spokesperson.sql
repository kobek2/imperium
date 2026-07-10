-- Seat Zohran Mamdani (W02 incumbent, slug w02-dem) as NYC Council Spokesperson.

do $$
declare
  zohran_id uuid;
begin
  select id into zohran_id
  from public.sim_politicians
  where slug = 'w02-dem';

  if zohran_id is null then
    raise exception 'sim_politician w02-dem (Zohran Mamdani) not found';
  end if;

  -- Clear any player-held council_spokesperson grant so the NPC is featured in directory.
  delete from public.government_role_grants g
  where g.role_key = 'council_spokesperson';

  update public.profiles
  set office_role = null, updated_at = now()
  where office_role = 'council_spokesperson';

  delete from public.sim_government_role_grants g
  where g.role_key = 'council_spokesperson';

  insert into public.sim_government_role_grants (sim_politician_id, role_key)
  values (zohran_id, 'council_spokesperson')
  on conflict (role_key) do update
    set sim_politician_id = excluded.sim_politician_id;
end;
$$;

notify pgrst, 'reload schema';
