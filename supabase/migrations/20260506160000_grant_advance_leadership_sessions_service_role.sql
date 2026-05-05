-- Calendar cron (service_role) must close elapsed leadership_sessions.
grant execute on function public.advance_leadership_sessions_by_schedule() to service_role;
