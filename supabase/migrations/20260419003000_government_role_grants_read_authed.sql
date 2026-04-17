-- Directory/hierarchy page needs authenticated read access to role grants.

drop policy if exists "government_role_grants read own" on public.government_role_grants;
drop policy if exists "government_role_grants read authed" on public.government_role_grants;

create policy "government_role_grants read authed" on public.government_role_grants
for select using (auth.role() = 'authenticated');