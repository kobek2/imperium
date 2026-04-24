-- Idempotent safety migration: ensure voters can change or clear their own ballots.

alter table public.primary_votes enable row level security;
alter table public.general_votes enable row level security;

drop policy if exists "primary votes delete self" on public.primary_votes;
drop policy if exists "primary votes update self" on public.primary_votes;
drop policy if exists "general votes delete self" on public.general_votes;
drop policy if exists "general votes update self" on public.general_votes;

create policy "primary votes delete self" on public.primary_votes
for delete using (auth.uid() = voter_id);

create policy "primary votes update self" on public.primary_votes
for update using (auth.uid() = voter_id);

create policy "general votes delete self" on public.general_votes
for delete using (auth.uid() = voter_id);

create policy "general votes update self" on public.general_votes
for update using (auth.uid() = voter_id);
