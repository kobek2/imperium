-- Remap legacy federal role grants to NYC city roles for active players.

insert into public.government_role_grants (user_id, role_key)
select g.user_id, 'mayor'
from public.government_role_grants g
where g.role_key = 'president'
on conflict (user_id, role_key) do nothing;

delete from public.government_role_grants g where g.role_key = 'president';

update public.profiles
set office_role = 'mayor', residence_state = 'MB', updated_at = now()
where office_role = 'president';

insert into public.government_role_grants (user_id, role_key)
select g.user_id, 'council_member'
from public.government_role_grants g
where g.role_key = 'representative'
on conflict (user_id, role_key) do nothing;

delete from public.government_role_grants g where g.role_key = 'representative';

update public.profiles
set office_role = 'council_member', residence_state = coalesce(nullif(residence_state, ''), 'MB'), updated_at = now()
where office_role = 'representative';

insert into public.government_role_grants (user_id, role_key)
select g.user_id, 'council_member'
from public.government_role_grants g
where g.role_key = 'senator'
on conflict (user_id, role_key) do nothing;

delete from public.government_role_grants g where g.role_key = 'senator';

update public.profiles
set office_role = 'council_member', residence_state = coalesce(nullif(residence_state, ''), 'MB'), updated_at = now()
where office_role = 'senator';

insert into public.government_role_grants (user_id, role_key)
select g.user_id, 'council_spokesperson'
from public.government_role_grants g
where g.role_key = 'speaker'
on conflict (user_id, role_key) do nothing;

delete from public.government_role_grants g where g.role_key = 'speaker';

update public.profiles
set office_role = 'council_spokesperson', updated_at = now()
where office_role = 'speaker';

notify pgrst, 'reload schema';
