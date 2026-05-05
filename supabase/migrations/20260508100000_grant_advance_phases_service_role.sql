-- Calendar cron runs as service_role; leadership close calls advance_election_phases_by_schedule().
grant execute on function public.advance_election_phases_by_schedule() to service_role;

notify pgrst, 'reload schema';
