-- Allow staff admins to insert calendar event rows (manual audit + future in-app triggers).
drop policy if exists "simulation_calendar_events insert admin" on public.simulation_calendar_events;
create policy "simulation_calendar_events insert admin"
  on public.simulation_calendar_events for insert
  to authenticated
  with check (public.is_staff_admin(auth.uid()));

notify pgrst, 'reload schema';
