-- Elections/simulation staff may delete published wire articles (moderation / corrections).

drop policy if exists "simulation_event_instances delete staff" on public.simulation_event_instances;
create policy "simulation_event_instances delete staff"
  on public.simulation_event_instances for delete
  using (public.is_staff_elections_moderator(auth.uid()));

notify pgrst, 'reload schema';
