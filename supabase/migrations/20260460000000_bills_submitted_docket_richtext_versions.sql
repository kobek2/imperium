-- Legislative flow: hopper → submitted; add on_docket before floor vote.
-- Rich text: content_html. Edit history: bill_versions.
-- RLS: bills updatable by leadership only (not author) after filing.

alter type public.bill_status rename value 'hopper' to 'submitted';

alter type public.bill_status add value 'on_docket';

alter table public.bills alter column status set default 'submitted';

alter table public.bills add column if not exists content_html text;

comment on column public.bills.content_html is 'Sanitized HTML from the bill editor; preferred for display when set.';
comment on column public.bills.content_md is 'Legacy plain/markdown body; used when content_html is null.';

create table if not exists public.bill_versions (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills (id) on delete cascade,
  content_html text not null,
  edited_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists bill_versions_bill_id_created_idx
  on public.bill_versions (bill_id, created_at desc);

alter table public.bill_versions enable row level security;

drop policy if exists "bill_versions read authed" on public.bill_versions;
create policy "bill_versions read authed" on public.bill_versions
  for select using (auth.role() = 'authenticated');

drop policy if exists "bill_versions insert leadership" on public.bill_versions;
create policy "bill_versions insert leadership" on public.bill_versions
  for insert with check (
    edited_by = auth.uid()
    and exists (
      select 1
      from public.bills b
      where b.id = bill_id
        and (
          exists (
            select 1
            from public.profiles p
            where p.id = auth.uid()
              and p.office_role in (
                'speaker',
                'house_majority_leader',
                'house_majority_whip',
                'senate_majority_leader',
                'senate_majority_whip',
                'president_pro_tempore',
                'president',
                'vice_president',
                'admin'
              )
          )
          or exists (
            select 1
            from public.government_role_grants g
            where g.user_id = auth.uid()
              and g.role_key in (
                'speaker',
                'house_majority_leader',
                'house_majority_whip',
                'senate_majority_leader',
                'senate_majority_whip',
                'president_pro_tempore',
                'president',
                'vice_president',
                'admin'
              )
          )
        )
    )
  );

drop policy if exists "bills update leadership or author" on public.bills;
drop policy if exists "bills update leadership" on public.bills;

-- Authors retained so deadline automation can update rows when any member loads the app;
-- content edits are enforced in server actions (leadership-only).
create policy "bills update leadership or author" on public.bills for update
  using (
    author_id = auth.uid()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.office_role in (
          'speaker',
          'house_majority_leader',
          'house_majority_whip',
          'senate_majority_leader',
          'senate_majority_whip',
          'president_pro_tempore',
          'president',
          'vice_president',
          'admin'
        )
    )
    or exists (
      select 1
      from public.government_role_grants g
      where g.user_id = auth.uid()
        and g.role_key in (
          'speaker',
          'house_majority_leader',
          'house_majority_whip',
          'senate_majority_leader',
          'senate_majority_whip',
          'president_pro_tempore',
          'president',
          'vice_president',
          'admin'
        )
    )
  );

notify pgrst, 'reload schema';
