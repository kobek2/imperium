-- Presidential tickets: optional running mate on each primary/general candidate row.
-- Running mates campaign on the same candidate_id (speeches/rallies); governance is app-gated.

alter table public.election_candidates
  add column if not exists running_mate_user_id uuid references auth.users (id) on delete set null;

alter table public.election_candidates
  drop constraint if exists election_candidates_running_mate_not_self;
alter table public.election_candidates
  add constraint election_candidates_running_mate_not_self
  check (running_mate_user_id is null or running_mate_user_id <> user_id);

create unique index if not exists election_candidates_one_mate_per_election
  on public.election_candidates (election_id, running_mate_user_id)
  where running_mate_user_id is not null;

comment on column public.election_candidates.running_mate_user_id is
  'President tickets only: co-campaigner during primary/general; app treats them like a second campaigner on the same row.';

-- Allow running mates to insert campaign events on the ticket (president + primary/general only).
drop policy if exists "campaign speeches insert self-candidate" on public.campaign_speeches;
create policy "campaign speeches insert self-candidate" on public.campaign_speeches
  for insert with check (
    auth.uid() = author_id
    and exists (
      select 1
      from public.election_candidates c
      join public.elections e on e.id = c.election_id
      where c.id = candidate_id
        and c.election_id = campaign_speeches.election_id
        and (
          c.user_id = auth.uid()
          or (
            e.office = 'president'
            and e.phase in ('primary', 'general')
            and c.running_mate_user_id = auth.uid()
          )
        )
    )
  );

drop policy if exists "campaign rallies insert self-candidate" on public.campaign_rallies;
create policy "campaign rallies insert self-candidate" on public.campaign_rallies
  for insert with check (
    auth.uid() = actor_id
    and exists (
      select 1
      from public.election_candidates c
      join public.elections e on e.id = c.election_id
      where c.id = candidate_id
        and c.election_id = campaign_rallies.election_id
        and (
          c.user_id = auth.uid()
          or (
            e.office = 'president'
            and e.phase in ('primary', 'general')
            and c.running_mate_user_id = auth.uid()
          )
        )
    )
  );

notify pgrst, 'reload schema';
