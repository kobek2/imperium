-- Post-character welcome tour: null = not finished; timestamp = done or skipped.
-- Rows that already exist when this migration runs are marked done so only net-new signups see /welcome.

alter table public.profiles
  add column if not exists orientation_completed_at timestamptz null;

comment on column public.profiles.orientation_completed_at is
  'Set when the player finishes or skips the short welcome tour (elections, economy, congress).';

update public.profiles
set orientation_completed_at = now()
where orientation_completed_at is null;

notify pgrst, 'reload schema';
