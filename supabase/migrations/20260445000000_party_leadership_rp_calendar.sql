-- Party leadership cadence follows the simulation RP calendar (simulation_settings), not wall-clock "2028" dates.

alter table public.party_organizations
  add column if not exists next_leadership_election_opens_on_rp date;

comment on column public.party_organizations.next_leadership_election_opens_on_rp is
  'First RP calendar day the biennial leadership filing window may open (compared to public.simulation_rp_calendar_date()).';

-- Mirrors web/src/lib/simulation-calendar.ts (mean month length, UTC noon anchor, pace from real_anchor_at).
create or replace function public.simulation_rp_calendar_date()
returns date
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  cfg record;
  anchor_ts timestamptz;
  elapsed_days numeric;
  pace numeric;
  off numeric;
  float_months numeric;
  whole int;
  frac numeric;
  after_whole timestamptz;
  at_ts timestamptz;
begin
  select rp_anchor_date, real_anchor_at, rp_months_per_real_day, admin_rp_month_offset
  into cfg
  from public.simulation_settings
  where id = 1;

  if not found then
    return (timezone('UTC', now()))::date;
  end if;

  anchor_ts := make_timestamptz(
    extract(year from cfg.rp_anchor_date)::int,
    extract(month from cfg.rp_anchor_date)::int,
    extract(day from cfg.rp_anchor_date)::int,
    12,
    0,
    0,
    'UTC'
  );

  elapsed_days := extract(epoch from (now() - cfg.real_anchor_at)) / 86400.0;
  pace := coalesce(cfg.rp_months_per_real_day, 3.5);
  off := coalesce(cfg.admin_rp_month_offset, 0);
  float_months := off + elapsed_days * pace;
  whole := floor(float_months)::int;
  frac := float_months - whole;

  after_whole := anchor_ts + make_interval(months => whole);
  at_ts := after_whole + (frac * 30.436875) * interval '1 day';

  return (timezone('UTC', at_ts))::date;
end;
$$;

grant execute on function public.simulation_rp_calendar_date() to authenticated;

update public.party_organizations
set
  next_leadership_election_opens_on_rp = coalesce(
    next_leadership_election_opens_on_rp,
    public.simulation_rp_calendar_date() + interval '2 years'
  )
where party_key in ('democrat', 'republican');

create or replace function public.party_tick_leadership_cycle(p_party text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  org record;
  r record;
  winner uuid;
  rp_today date;
  next_rp date;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_party not in ('democrat', 'republican') then raise exception 'Invalid party'; end if;

  rp_today := public.simulation_rp_calendar_date();

  select * into org from public.party_organizations where party_key = p_party for update;

  if org.leadership_phase = 'idle'
     and org.next_leadership_election_opens_on_rp is not null
     and rp_today >= org.next_leadership_election_opens_on_rp then
    update public.party_organizations
    set
      leadership_phase = 'filing',
      leadership_filing_ends_at = now() + interval '14 days',
      leadership_voting_ends_at = null,
      updated_at = now()
    where party_key = p_party;
    return jsonb_build_object('ok', true, 'event', 'filing_opened', 'filing_ends_at', (now() + interval '14 days'));
  end if;

  if org.leadership_phase = 'filing'
     and org.leadership_filing_ends_at is not null
     and org.leadership_filing_ends_at <= now() then
    update public.party_organizations
    set
      leadership_phase = 'voting',
      leadership_voting_ends_at = now() + interval '14 days',
      updated_at = now()
    where party_key = p_party;
    return jsonb_build_object('ok', true, 'event', 'voting_opened', 'voting_ends_at', (now() + interval '14 days'));
  end if;

  if org.leadership_phase = 'voting'
     and org.leadership_voting_ends_at is not null
     and org.leadership_voting_ends_at <= now() then
    for r in
      select * from unnest(array['chair', 'vice_chair', 'treasurer']::text[]) as x(office)
    loop
      winner := null;
      select v.candidate_id
      into winner
      from public.party_officer_votes v
      where v.party_key = p_party and v.office = r.office
      group by v.candidate_id
      order by count(*) desc, v.candidate_id asc
      limit 1;

      if winner is not null then
        insert into public.party_officers (party_key, office, user_id, since)
        values (p_party, r.office, winner, now())
        on conflict (party_key, office) do update
        set user_id = excluded.user_id, since = excluded.since;
      end if;

      delete from public.party_officer_votes where party_key = p_party and office = r.office;
      delete from public.party_officer_candidacies where party_key = p_party and office = r.office;
    end loop;

    next_rp := rp_today + interval '2 years';

    update public.party_organizations
    set
      leadership_phase = 'idle',
      leadership_filing_ends_at = null,
      leadership_voting_ends_at = null,
      last_leadership_cycle_completed_at = now(),
      next_leadership_election_opens_on_rp = next_rp,
      next_leadership_election_opens_at = null,
      updated_at = now()
    where party_key = p_party;

    return jsonb_build_object('ok', true, 'event', 'cycle_completed', 'next_opens_on_rp', next_rp);
  end if;

  return jsonb_build_object('ok', true, 'event', 'noop', 'phase', org.leadership_phase);
end;
$$;

notify pgrst, 'reload schema';
