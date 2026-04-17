-- Additional RLS for leadership updates and appointments

create policy "bills update leadership or author" on public.bills for update
  using (
    author_id = auth.uid()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.office_role in (
          'speaker',
          'senate_majority_leader',
          'president',
          'vice_president',
          'admin'
        )
    )
  );

create policy "appointments insert president" on public.appointments for insert
  with check (
    president_user_id = auth.uid()
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.office_role in ('president', 'admin')
    )
  );

create policy "appointments update nominee status" on public.appointments for update
  using (
    nominee_user_id = auth.uid()
    or president_user_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.office_role = 'admin'
    )
  );

create policy "bill votes delete self" on public.bill_votes for delete
  using (voter_id = auth.uid());
