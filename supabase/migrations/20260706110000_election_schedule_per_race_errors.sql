-- Isolate per-race failures so one bad election does not abort the whole scheduler.

create or replace function public.advance_election_phases_by_schedule()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  update public.elections
  set phase = 'primary'::public.election_phase
  where phase = 'filing'::public.election_phase
    and leadership_role is null
    and filing_window_started_at is not null
    and filing_closes_at is not null
    and filing_closes_at < now();

  update public.elections
  set phase = 'general'::public.election_phase
  where phase = 'filing'::public.election_phase
    and leadership_role is not null
    and filing_window_started_at is not null
    and filing_closes_at is not null
    and filing_closes_at < now();

  for r in
    select e.id
    from public.elections e
    where e.phase = 'primary'::public.election_phase
      and e.filing_window_started_at is not null
      and e.primary_closes_at is not null
      and e.primary_closes_at < now()
  loop
    begin
      perform public._close_primary_for_election(r.id);
    exception
      when others then
        raise warning 'advance_election_phases: primary close failed for %: %', r.id, sqlerrm;
    end;
  end loop;

  for r in
    select e.id
    from public.elections e
    where e.phase = 'general'::public.election_phase
      and e.filing_window_started_at is not null
      and e.general_closes_at is not null
      and e.general_closes_at < now()
  loop
    begin
      perform public._close_general_for_election(r.id);
    exception
      when others then
        raise warning 'advance_election_phases: general close failed for %: %', r.id, sqlerrm;
    end;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
