-- Inbox notifications: more in-character (RP) titles and bodies for election wins, bills, and party roles.
-- Term-end dates use public.simulation_rp_calendar_date() plus conventional seat lengths in RP calendar time.

create or replace function public._inbox_election_closed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role_label text;
  v_term_end date;
  v_title text;
  v_body text;
begin
  if new.phase is distinct from 'closed' or new.winner_user_id is null then
    return new;
  end if;
  if old.phase = 'closed' and old.winner_user_id is not distinct from new.winner_user_id then
    return new;
  end if;

  if new.leadership_role is not null then
    v_role_label := case new.leadership_role
      when 'speaker' then 'Speaker of the House'
      when 'house_majority_leader' then 'House Majority Leader'
      when 'house_majority_whip' then 'House Majority Whip'
      when 'house_minority_leader' then 'House Minority Leader'
      when 'house_minority_whip' then 'House Minority Whip'
      when 'senate_majority_leader' then 'Senate Majority Leader'
      when 'senate_majority_whip' then 'Senate Majority Whip'
      when 'senate_minority_leader' then 'Senate Minority Leader'
      when 'senate_minority_whip' then 'Senate Minority Whip'
      when 'president_pro_tempore' then 'President pro tempore of the Senate'
      else initcap(replace(new.leadership_role, '_', ' '))
    end;
    v_term_end := (public.simulation_rp_calendar_date() + interval '2 years')::date;
  elsif new.office = 'house' then
    v_role_label := 'Representative for ' || coalesce(new.district_code, 'your district');
    v_term_end := (public.simulation_rp_calendar_date() + interval '2 years')::date;
  elsif new.office = 'senate' then
    v_role_label := 'United States Senator for ' || coalesce(new.state::text, 'your state');
    v_term_end := (public.simulation_rp_calendar_date() + interval '6 years')::date;
  else
    v_role_label := 'President of the United States';
    v_term_end := (public.simulation_rp_calendar_date() + interval '4 years')::date;
  end if;

  v_title := 'Congratulations — you won your race';
  v_body :=
    'The polls are certified: you have been elected ' || v_role_label
    || '. Your credentials are on file with the Clerk; the in-universe calendar currently records your term through '
    || to_char(v_term_end, 'FMMonth FMDD, FMYYYY')
    || '. Floor access and the directory listing now reflect your office.';

  insert into public.inbox_items (user_id, kind, title, body, href, dedupe_key)
  values (
    new.winner_user_id,
    'election_win',
    v_title,
    v_body,
    '/elections/' || new.id::text,
    'election:' || new.id::text
  )
  on conflict (user_id, dedupe_key) do nothing;

  return new;
end;
$$;

create or replace function public._inbox_bill_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
  v_body text;
  t text;
begin
  if new.author_id is null then return new; end if;
  if new.status not in ('law', 'vetoed', 'passed_congress', 'oval') then return new; end if;
  if old.status is not distinct from new.status then return new; end if;

  t := coalesce(nullif(trim(both from new.title), ''), 'your measure');

  case new.status
    when 'law' then
      v_title := 'Enrolled — your bill is now the law of the land';
      v_body :=
        'The President has signed '
        || t
        || ' following enrollment. You may brief your caucus and staff; the statute is in force for the simulation.';
    when 'vetoed' then
      v_title := 'The President has vetoed your measure';
      v_body :=
        'The veto message is on file for '
        || t
        || '. Congress may yet attempt an override; until then, this chapter of the legislative record is closed.';
    when 'passed_congress' then
      v_title := 'Congress has sent your bill to the President';
      v_body :=
        'Both chambers have acted on '
        || t
        || '. The engrossed measure is on its way to the Oval Office for signature or veto.';
    when 'oval' then
      v_title := 'Your bill has reached the President''s desk';
      v_body :=
        'The Clerk has delivered '
        || t
        || ' for presentment. The White House may sign, veto, or pocket the measure per sim rules.';
    else
      v_title := 'Legislative update';
      v_body := t;
  end case;

  insert into public.inbox_items (user_id, kind, title, body, href, dedupe_key)
  values (
    new.author_id,
    'bill_milestone',
    v_title,
    v_body,
    '/congress',
    'bill:' || new.id::text || ':' || new.status::text
  )
  on conflict (user_id, dedupe_key) do nothing;

  return new;
end;
$$;

create or replace function public._inbox_party_officer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_party text;
  v_office text;
  v_title text;
  v_body text;
begin
  if new.user_id is null then return new; end if;
  if tg_op = 'UPDATE' and old.user_id is not distinct from new.user_id then return new; end if;

  v_party := case new.party_key
    when 'democrat' then 'Democratic Party'
    when 'republican' then 'Republican Party'
    else initcap(new.party_key)
  end;
  v_office := case new.office
    when 'chair' then 'Party Chair'
    when 'vice_chair' then 'Party Vice Chair'
    when 'treasurer' then 'Party Treasurer'
    else initcap(replace(new.office::text, '_', ' '))
  end;

  v_title := 'The caucus has placed you in leadership';
  v_body :=
    'Following the party''s internal process, you are now recorded as '
    || v_office
    || ' of the '
    || v_party
    || '. Expect the steering committee to route strategy memos and treasury notices to your office.';

  insert into public.inbox_items (user_id, kind, title, body, href, dedupe_key)
  values (
    new.user_id,
    'party_leadership',
    v_title,
    v_body,
    '/parties/' || new.party_key,
    'party_officer:' || new.party_key || ':' || new.office || ':' || new.since::text
  )
  on conflict (user_id, dedupe_key) do nothing;

  return new;
end;
$$;

notify pgrst, 'reload schema';
