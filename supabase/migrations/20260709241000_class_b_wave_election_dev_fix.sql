-- Class B wave dev helper: reopen closed races, start dormant filings, return diagnostics.

create or replace function public.admin_open_class_b_elections_now(
  p_city_code char(2) default 'MB',
  p_reopen_closed boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  epoch timestamptz;
  cycle_idx bigint;
  even_yr smallint;
  created int := 0;
  reopened int := 0;
  existing_active int := 0;
  existing_closed int := 0;
  wards_expected int := 0;
  t0 timestamptz := now();
begin
  if v_uid is null or not public.is_staff_admin(v_uid) then
    raise exception 'Admin only';
  end if;

  select coalesce(epoch_started_at, now()) into epoch
  from public.city_sim_engine_state
  where city_code = p_city_code;

  cycle_idx := public._city_cycle_index_from_epoch(epoch);
  even_yr := (cycle_idx * 2 + 2)::smallint;

  select count(*)::int into wards_expected
  from public.wards w
  where w.city_code = p_city_code and w.election_class = 'B';

  created := public._city_open_election_cycle(p_city_code, even_yr, t0);

  select count(*)::int into existing_active
  from public.elections e
  join public.wards w on w.code = e.ward_code and w.city_code = p_city_code
  where public._city_is_mb_election(e.office::text, e.state)
    and e.office = 'council_ward'
    and w.election_class = 'B'
    and e.city_sim_year = even_yr
    and e.phase <> 'closed'::public.election_phase;

  select count(*)::int into existing_closed
  from public.elections e
  join public.wards w on w.code = e.ward_code and w.city_code = p_city_code
  where public._city_is_mb_election(e.office::text, e.state)
    and e.office = 'council_ward'
    and w.election_class = 'B'
    and e.city_sim_year = even_yr
    and e.phase = 'closed'::public.election_phase;

  -- Dormant filing rows (no window started) never appear on /elections — kick them live.
  update public.elections e
  set
    filing_window_started_at = coalesce(e.filing_window_started_at, t0),
    filing_opens_at = coalesce(e.filing_opens_at, t0),
    filing_closes_at = coalesce(e.filing_closes_at, t0 + interval '12 hours'),
    primary_closes_at = coalesce(e.primary_closes_at, t0 + interval '24 hours'),
    general_closes_at = coalesce(e.general_closes_at, t0 + interval '48 hours'),
    phase = case
      when e.phase = 'closed'::public.election_phase then e.phase
      else coalesce(e.phase, 'filing'::public.election_phase)
    end
  from public.wards w
  where e.ward_code = w.code
    and w.city_code = p_city_code
    and w.election_class = 'B'
    and public._city_is_mb_election(e.office::text, e.state)
    and e.city_sim_year = even_yr
    and e.filing_window_started_at is null;

  if p_reopen_closed and created = 0 and existing_active = 0 and existing_closed > 0 then
    update public.elections e
    set
      phase = 'filing'::public.election_phase,
      filing_window_started_at = t0,
      filing_opens_at = t0,
      filing_closes_at = t0 + interval '12 hours',
      primary_closes_at = t0 + interval '24 hours',
      general_closes_at = t0 + interval '48 hours',
      oath_pending = false
    from public.wards w
    where e.ward_code = w.code
      and w.city_code = p_city_code
      and w.election_class = 'B'
      and public._city_is_mb_election(e.office::text, e.state)
      and e.city_sim_year = even_yr
      and e.phase = 'closed'::public.election_phase;

    get diagnostics reopened = row_count;

    select count(*)::int into existing_active
    from public.elections e
    join public.wards w on w.code = e.ward_code and w.city_code = p_city_code
    where public._city_is_mb_election(e.office::text, e.state)
      and e.office = 'council_ward'
      and w.election_class = 'B'
      and e.city_sim_year = even_yr
      and e.phase <> 'closed'::public.election_phase;
  end if;

  return jsonb_build_object(
    'ok', true,
    'created', created,
    'reopened', reopened,
    'existing_active', existing_active,
    'existing_closed', existing_closed,
    'wards_expected', wards_expected,
    'sim_year', even_yr,
    'wave', 'class_b'
  );
end;
$$;

notify pgrst, 'reload schema';
