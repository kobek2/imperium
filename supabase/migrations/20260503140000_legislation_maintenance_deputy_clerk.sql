-- Auto-advance legislation when leadership deadlines pass; rotating House/Senate Deputy & Clerk
-- from economy hourly_income collect counts (excludes Speaker / Senate Majority Leader from rotation).

create or replace function public.legislation_apply_leadership_deadlines()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Hopper: auto-accept to debate + start debate auto-floor clock (matches app leadership accept).
  update public.bills b
  set
    status = 'debate',
    debate_started_at = now(),
    leadership_deadline_at = now() + interval '24 hours',
    chamber_vote_deadline_at = null,
    vp_tie_break_pending = false
  where b.status = 'submitted'
    and b.leadership_deadline_at is not null
    and b.leadership_deadline_at < now();

  -- Other chamber: auto-accept to debate in receiving chamber.
  update public.bills b
  set
    status = 'other_chamber_debate',
    debate_started_at = now(),
    leadership_deadline_at = now() + interval '24 hours',
    chamber_vote_deadline_at = null,
    vp_tie_break_pending = false
  where b.status = 'other_chamber_review'
    and b.leadership_deadline_at is not null
    and b.leadership_deadline_at < now();

  -- Debate phases: open floor with default 24h vote when scheduling window elapsed and no pending amendments.
  update public.bills b
  set
    status = case
      when b.status = 'debate' then
        case
          when b.originating_chamber = 'house' then 'house_floor'::public.bill_status
          else 'senate_floor'::public.bill_status
        end
      when b.status = 'other_chamber_debate' then
        case
          when b.originating_chamber = 'house' then 'senate_floor'::public.bill_status
          else 'house_floor'::public.bill_status
        end
      else b.status
    end,
    leadership_deadline_at = null,
    chamber_vote_deadline_at = now() + interval '24 hours',
    vp_tie_break_pending = false
  where b.status in ('debate', 'other_chamber_debate')
    and b.chamber_vote_deadline_at is null
    and not exists (
      select 1
      from public.bill_amendments a
      where a.bill_id = b.id
        and a.status = 'pending'
    )
    and (
      (b.leadership_deadline_at is not null and b.leadership_deadline_at < now())
      or (
        b.leadership_deadline_at is null
        and b.debate_started_at is not null
        and b.debate_started_at + interval '24 hours' < now()
      )
    );

  -- Legacy on-docket: auto floor vote when docket clock elapsed.
  update public.bills b
  set
    status = case
      when b.originating_chamber = 'house' then 'house_floor'::public.bill_status
      else 'senate_floor'::public.bill_status
    end,
    leadership_deadline_at = null,
    chamber_vote_deadline_at = now() + interval '24 hours',
    vp_tie_break_pending = false
  where b.status = 'on_docket'
    and b.leadership_deadline_at is not null
    and b.leadership_deadline_at < now()
    and not exists (
      select 1
      from public.bill_amendments a
      where a.bill_id = b.id
        and a.status = 'pending'
    );
end;
$$;

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
  where rn = 1
  union all
  select uid, 'house_clerk'::text
  from house_ranked
  where rn = 2;

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
  where rn = 1
  union all
  select uid, 'senate_clerk'::text
  from senate_ranked
  where rn = 2;
end;
$$;

create or replace function public.legislation_run_maintenance()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.legislation_apply_leadership_deadlines();
  perform public.legislation_refresh_deputy_clerk_roles();
end;
$$;

revoke all on function public.legislation_apply_leadership_deadlines() from public;
revoke all on function public.legislation_refresh_deputy_clerk_roles() from public;
revoke all on function public.legislation_run_maintenance() from public;

grant execute on function public.legislation_run_maintenance() to authenticated;
grant execute on function public.legislation_run_maintenance() to service_role;

-- Bills: Deputy / Clerk may update bills the same way as chamber leadership (app-enforced edits).
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
          'house_clerk',
          'house_majority_leader',
          'house_majority_whip',
          'senate_majority_leader',
          'senate_deputy',
          'senate_clerk',
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
          'house_clerk',
          'house_majority_leader',
          'house_majority_whip',
          'senate_majority_leader',
          'senate_deputy',
          'senate_clerk',
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
                'house_clerk',
                'house_majority_leader',
                'house_majority_whip',
                'senate_majority_leader',
                'senate_deputy',
                'senate_clerk',
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
                'house_clerk',
                'house_majority_leader',
                'house_majority_whip',
                'senate_majority_leader',
                'senate_deputy',
                'senate_clerk',
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
