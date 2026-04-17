-- Align bill / appointment updates with Discord-synced government_role_grants

drop policy if exists "bills update leadership or author" on public.bills;

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

drop policy if exists "appointments insert president" on public.appointments;

create policy "appointments insert president" on public.appointments for insert
  with check (
    president_user_id = auth.uid()
    and (
      exists (
        select 1
        from public.profiles p
        where p.id = auth.uid()
          and p.office_role in ('president', 'admin')
      )
      or exists (
        select 1
        from public.government_role_grants g
        where g.user_id = auth.uid()
          and g.role_key in ('president', 'admin')
      )
    )
  );
