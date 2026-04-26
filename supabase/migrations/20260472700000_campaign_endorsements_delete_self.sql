-- Allow users to withdraw their own campaign endorsements.

drop policy if exists "campaign endorsements delete self" on public.campaign_endorsements;

create policy "campaign endorsements delete self" on public.campaign_endorsements
for delete using (auth.uid() = endorser_user_id);

notify pgrst, 'reload schema';
