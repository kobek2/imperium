-- Let candidates withdraw during filing so they can switch House ↔ Senate (one active
-- congressional race at a time). Deletes are OR-combined with the existing admin policy.

drop policy if exists "election_candidates delete own during filing" on public.election_candidates;

create policy "election_candidates delete own during filing"
on public.election_candidates
for delete
to authenticated
using (
  auth.uid() = user_id
  and exists (
    select 1
    from public.elections e
    where e.id = election_candidates.election_id
      and e.phase = 'filing'::public.election_phase
  )
);
