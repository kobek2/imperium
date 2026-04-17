-- Admin-only mutations on elections and candidate rows (no SQL editor needed day-to-day)

create or replace function public.is_staff_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = uid and p.office_role = 'admin'
  )
  or exists (
    select 1 from public.government_role_grants g
    where g.user_id = uid and g.role_key = 'admin'
  );
$$;

grant execute on function public.is_staff_admin(uuid) to authenticated;

create policy "elections insert admin" on public.elections for insert
  with check (public.is_staff_admin(auth.uid()));

create policy "elections update admin" on public.elections for update
  using (public.is_staff_admin(auth.uid()));

create policy "elections delete admin" on public.elections for delete
  using (public.is_staff_admin(auth.uid()));

create policy "election_candidates update admin" on public.election_candidates for update
  using (public.is_staff_admin(auth.uid()));

create policy "election_candidates delete admin" on public.election_candidates for delete
  using (public.is_staff_admin(auth.uid()));
