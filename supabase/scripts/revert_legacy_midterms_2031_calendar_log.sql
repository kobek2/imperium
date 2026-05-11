-- Remove obsolete calendar log rows from the old naming (`midterms_open_2031` / `midterms_seated_2031`)
-- before we switched to U.S. **election year** keys (`midterms_open_2030`, etc.).
-- Safe if no rows match. Does not touch elections, grants, or profiles.

begin;

delete from public.simulation_calendar_events
where event_key in ('midterms_open_2031', 'midterms_seated_2031', 'leadership_close_midterm_2031');

commit;
