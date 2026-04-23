-- Notify House / Senate members and chamber leaders when a bill enters floor status for a roll-call vote.

create or replace function public._inbox_bill_chamber_floor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chamber text;
  v_title text;
  v_body text;
  v_href text;
  v_dedupe text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if new.status not in ('house_floor', 'senate_floor') then
    return new;
  end if;

  v_chamber := case new.status
    when 'house_floor' then 'House'
    when 'senate_floor' then 'Senate'
  end;

  v_title := v_chamber || ' floor: measure open for roll call';
  v_body :=
    'The clerk has posted a measure now open for recorded votes: '
    || coalesce(nullif(trim(both from new.title), ''), 'Untitled measure')
    || '. Cast your vote before the floor clock expires.';

  v_href := '/bill/' || new.id::text;
  v_dedupe := 'bill_floor_open:' || new.id::text || ':' || new.status::text;

  if new.status = 'house_floor' then
    insert into public.inbox_items (user_id, kind, title, body, href, dedupe_key)
    select distinct u.uid, 'bill_milestone', v_title, v_body, v_href, v_dedupe
    from (
      select g.user_id as uid
      from public.government_role_grants g
      where g.role_key in (
        'representative',
        'speaker',
        'house_majority_leader',
        'house_majority_whip',
        'house_minority_leader',
        'house_minority_whip'
      )
      union
      select p.id as uid
      from public.profiles p
      where p.office_role in (
        'representative',
        'speaker',
        'house_majority_leader',
        'house_majority_whip',
        'house_minority_leader',
        'house_minority_whip'
      )
    ) u
    where u.uid is not null
    on conflict (user_id, dedupe_key) do nothing;

  elsif new.status = 'senate_floor' then
    insert into public.inbox_items (user_id, kind, title, body, href, dedupe_key)
    select distinct u.uid, 'bill_milestone', v_title, v_body, v_href, v_dedupe
    from (
      select g.user_id as uid
      from public.government_role_grants g
      where g.role_key in (
        'senator',
        'president_pro_tempore',
        'senate_majority_leader',
        'senate_majority_whip',
        'senate_minority_leader',
        'senate_minority_whip',
        'vice_president'
      )
      union
      select p.id as uid
      from public.profiles p
      where p.office_role in (
        'senator',
        'president_pro_tempore',
        'senate_majority_leader',
        'senate_majority_whip',
        'senate_minority_leader',
        'senate_minority_whip',
        'vice_president'
      )
    ) u
    where u.uid is not null
    on conflict (user_id, dedupe_key) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists inbox_on_bill_chamber_floor on public.bills;
create trigger inbox_on_bill_chamber_floor
  after update of status on public.bills
  for each row
  when (new.status in ('house_floor', 'senate_floor') and old.status is distinct from new.status)
  execute function public._inbox_bill_chamber_floor();

notify pgrst, 'reload schema';
