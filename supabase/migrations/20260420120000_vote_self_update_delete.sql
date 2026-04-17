-- Allow voters to change or clear their own primary/general ballots (required for upsert + withdraw).

create policy "primary votes delete self" on public.primary_votes
  for delete
  using (auth.uid() = voter_id);

create policy "primary votes update self" on public.primary_votes
  for update
  using (auth.uid() = voter_id)
  with check (auth.uid() = voter_id);

create policy "general votes delete self" on public.general_votes
  for delete
  using (auth.uid() = voter_id);

create policy "general votes update self" on public.general_votes
  for update
  using (auth.uid() = voter_id)
  with check (auth.uid() = voter_id);
