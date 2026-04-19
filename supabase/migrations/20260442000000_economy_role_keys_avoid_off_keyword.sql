-- PL/pgSQL variable name "off" conflicted with SQL keyword OFF in some clients / parsers ("relation off does not exist").
create or replace function public._economy_effective_role_keys(p_uid uuid)
returns text[]
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  keys text[] := array[]::text[];
  k text;
  v_profile_office_role text;
begin
  for k in select g.role_key from public.government_role_grants g where g.user_id = p_uid
  loop
    if not (k = any(keys)) then
      keys := array_append(keys, k);
    end if;
  end loop;
  select p.office_role into v_profile_office_role from public.profiles p where p.id = p_uid;
  if v_profile_office_role is not null and not (v_profile_office_role = any(keys)) then
    keys := array_append(keys, v_profile_office_role);
  end if;
  return keys;
end;
$$;

notify pgrst, 'reload schema';
