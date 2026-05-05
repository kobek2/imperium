-- Single hopper/floor backup per chamber: Deputy only (remove House/Senate Clerk).

delete from public.government_role_grants
where role_key in ('house_clerk', 'senate_clerk');

update public.profiles
set office_role = null, updated_at = now()
where office_role in ('house_clerk', 'senate_clerk');

create or replace function public.legislation_refresh_deputy_clerk_roles()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.government_role_grants g
  where g.role_key in ('house_deputy', 'house_clerk', 'senate_deputy', 'senate_clerk');

  insert into public.government_role_grants (user_id, role_key)
  with
  collects as (
    select el.wallet_user_id as uid, count(*)::bigint as n
    from public.economy_ledger el
    where el.kind = 'hourly_income'
    group by el.wallet_user_id
  ),
  house_members as (
    select distinct g.user_id as uid
    from public.government_role_grants g
    where g.role_key = 'representative'
    union
    select distinct p.id as uid
    from public.profiles p
    where p.office_role = 'representative'
  ),
  house_speakers as (
    select distinct g.user_id as uid
    from public.government_role_grants g
    where g.role_key = 'speaker'
    union
    select distinct p.id as uid
    from public.profiles p
    where p.office_role = 'speaker'
  ),
  house_eligible as (
    select hm.uid
    from house_members hm
    where not exists (select 1 from house_speakers sp where sp.uid = hm.uid)
  ),
  house_scored as (
    select he.uid, coalesce(c.n, 0::bigint) as n
    from house_eligible he
    left join collects c on c.uid = he.uid
  ),
  house_ranked as (
    select uid, row_number() over (order by n desc, uid asc) as rn
    from house_scored
  )
  select uid, 'house_deputy'::text
  from house_ranked
  where rn = 1;

  insert into public.government_role_grants (user_id, role_key)
  with
  collects as (
    select el.wallet_user_id as uid, count(*)::bigint as n
    from public.economy_ledger el
    where el.kind = 'hourly_income'
    group by el.wallet_user_id
  ),
  senate_members as (
    select distinct g.user_id as uid
    from public.government_role_grants g
    where g.role_key = 'senator'
    union
    select distinct p.id as uid
    from public.profiles p
    where p.office_role = 'senator'
  ),
  senate_mls as (
    select distinct g.user_id as uid
    from public.government_role_grants g
    where g.role_key = 'senate_majority_leader'
    union
    select distinct p.id as uid
    from public.profiles p
    where p.office_role = 'senate_majority_leader'
  ),
  senate_eligible as (
    select sm.uid
    from senate_members sm
    where not exists (select 1 from senate_mls ml where ml.uid = sm.uid)
  ),
  senate_scored as (
    select se.uid, coalesce(c.n, 0::bigint) as n
    from senate_eligible se
    left join collects c on c.uid = se.uid
  ),
  senate_ranked as (
    select uid, row_number() over (order by n desc, uid asc) as rn
    from senate_scored
  )
  select uid, 'senate_deputy'::text
  from senate_ranked
  where rn = 1;
end;
$$;

-- Bills: Deputy may update bills the same way as chamber leadership (app-enforced edits).
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
          'house_deputy',
          'house_majority_leader',
          'house_majority_whip',
          'senate_majority_leader',
          'senate_deputy',
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
          'house_deputy',
          'house_majority_leader',
          'house_majority_whip',
          'senate_majority_leader',
          'senate_deputy',
          'senate_majority_whip',
          'president_pro_tempore',
          'president',
          'vice_president',
          'admin'
        )
    )
  );

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
                'house_deputy',
                'house_majority_leader',
                'house_majority_whip',
                'senate_majority_leader',
                'senate_deputy',
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
                'house_deputy',
                'house_majority_leader',
                'house_majority_whip',
                'senate_majority_leader',
                'senate_deputy',
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

notify pgrst, 'reload schema';
