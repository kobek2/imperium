-- Elections/simulation staff (not only legacy admin) may delete campaign speeches for moderation.

create or replace function public.is_staff_elections_moderator(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_staff_admin(uid)
  or exists (
    select 1
    from public.government_role_grants g
    where g.user_id = uid
      and g.role_key in ('staff_elections', 'staff_simulation')
  );
$$;

grant execute on function public.is_staff_elections_moderator(uuid) to authenticated;

drop policy if exists "campaign speeches delete admin" on public.campaign_speeches;
create policy "campaign speeches delete staff" on public.campaign_speeches
  for delete
  using (public.is_staff_elections_moderator(auth.uid()));

comment on function public.is_staff_elections_moderator(uuid) is
  'True for full staff admins and grants staff_elections / staff_simulation (election console moderators).';
