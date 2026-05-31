-- Staff admin: appoint President and Vice President without a closed presidential election.

create or replace function public.admin_appoint_president(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  leadership text[] := array[
    'speaker',
    'house_majority_leader', 'house_majority_whip',
    'house_minority_leader', 'house_minority_whip',
    'senate_majority_leader', 'senate_majority_whip',
    'senate_minority_leader', 'senate_minority_whip',
    'president_pro_tempore'
  ];
  incompat text[] := array['representative', 'senator', 'vice_president'];
  prior_uid uuid;
begin
  if auth.uid() is null or not public.is_staff_admin(auth.uid()) then
    raise exception 'Admin only';
  end if;

  for prior_uid in
    select g.user_id
    from public.government_role_grants g
    where g.role_key = 'president'
      and g.user_id is distinct from p_user_id
    union
    select p.id
    from public.profiles p
    where p.office_role = 'president'
      and p.id is distinct from p_user_id
  loop
    delete from public.government_role_grants g
    where g.user_id = prior_uid and g.role_key = 'president';
    update public.profiles p
    set office_role = null, updated_at = now()
    where p.id = prior_uid and p.office_role = 'president';
  end loop;

  delete from public.government_role_grants g
  where g.user_id = p_user_id
    and (g.role_key = any(leadership) or g.role_key = any(incompat));

  insert into public.government_role_grants (user_id, role_key)
  values (p_user_id, 'president')
  on conflict (user_id, role_key) do nothing;

  update public.profiles p
  set office_role = 'president',
      updated_at = now()
  where p.id = p_user_id
    and (
      p.office_role is null
      or p.office_role = 'citizen'
      or p.office_role = 'president'
      or p.office_role = any(incompat)
      or p.office_role = any(leadership)
    );

  return jsonb_build_object('ok', true, 'role', 'president');
end;
$$;

create or replace function public.admin_appoint_vice_president(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  leadership text[] := array[
    'speaker',
    'house_majority_leader', 'house_majority_whip',
    'house_minority_leader', 'house_minority_whip',
    'senate_majority_leader', 'senate_majority_whip',
    'senate_minority_leader', 'senate_minority_whip',
    'president_pro_tempore'
  ];
  incompat text[] := array['representative', 'senator', 'president', 'vice_president'];
  prior_uid uuid;
begin
  if auth.uid() is null or not public.is_staff_admin(auth.uid()) then
    raise exception 'Admin only';
  end if;

  for prior_uid in
    select g.user_id
    from public.government_role_grants g
    where g.role_key = 'vice_president'
      and g.user_id is distinct from p_user_id
    union
    select p.id
    from public.profiles p
    where p.office_role = 'vice_president'
      and p.id is distinct from p_user_id
  loop
    delete from public.government_role_grants g
    where g.user_id = prior_uid and g.role_key = 'vice_president';
    update public.profiles p
    set office_role = null, updated_at = now()
    where p.id = prior_uid and p.office_role = 'vice_president';
  end loop;

  delete from public.government_role_grants g
  where g.user_id = p_user_id
    and (g.role_key = any(leadership) or g.role_key = any(incompat));

  insert into public.government_role_grants (user_id, role_key)
  values (p_user_id, 'vice_president')
  on conflict (user_id, role_key) do nothing;

  update public.profiles p
  set office_role = 'vice_president',
      updated_at = now()
  where p.id = p_user_id
    and (
      p.office_role is null
      or p.office_role = 'citizen'
      or p.office_role = 'vice_president'
      or p.office_role = any(incompat)
      or p.office_role = any(leadership)
    );

  return jsonb_build_object('ok', true, 'role', 'vice_president');
end;
$$;

revoke all on function public.admin_appoint_president(uuid) from public;
revoke all on function public.admin_appoint_vice_president(uuid) from public;

grant execute on function public.admin_appoint_president(uuid) to authenticated;
grant execute on function public.admin_appoint_vice_president(uuid) to authenticated;

notify pgrst, 'reload schema';
