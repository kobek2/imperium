-- Allow staff admins to grant/revoke office roles from the app.
-- Needed for election finalize role transfer.

drop policy if exists "government_role_grants admin insert" on public.government_role_grants;
drop policy if exists "government_role_grants admin delete" on public.government_role_grants;

create policy "government_role_grants admin insert"
on public.government_role_grants
for insert
with check (public.is_staff_admin(auth.uid()));

create policy "government_role_grants admin delete"
on public.government_role_grants
for delete
using (public.is_staff_admin(auth.uid()));