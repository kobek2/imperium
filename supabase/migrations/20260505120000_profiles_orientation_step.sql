-- Linear orientation tour: 1 = elections, 2 = economy, 3 = congress; null when not in tour.
-- Completed tours use orientation_completed_at (existing) and clear orientation_step.

alter table public.profiles
  add column if not exists orientation_step smallint null;

comment on column public.profiles.orientation_step is
  '1 elections leg, 2 economy leg, 3 congress leg; null when tour finished or not started.';

update public.profiles
set orientation_step = null
where orientation_completed_at is not null;

update public.profiles
set orientation_step = 1
where orientation_completed_at is null
  and orientation_step is null
  and character_name is not null
  and trim(character_name) <> ''
  and date_of_birth is not null
  and residence_state is not null
  and home_district_code is not null
  and party is not null;

notify pgrst, 'reload schema';
