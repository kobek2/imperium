-- Staff admins may remove campaign speeches (e.g. low-quality or policy violations).
-- campaign_speeches_points_sync subtracts points on DELETE, so election_candidates.campaign_points_total
-- and presidential per-state scoring stay consistent after removal.

drop policy if exists "campaign speeches delete admin" on public.campaign_speeches;
create policy "campaign speeches delete admin" on public.campaign_speeches
  for delete
  using (public.is_staff_admin(auth.uid()));
