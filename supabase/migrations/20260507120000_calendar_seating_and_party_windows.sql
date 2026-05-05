-- Calendar v2 seating: idempotency columns + definer RPCs for cron/service role (no auth.uid()).

alter table public.elections
  add column if not exists calendar_seated_at timestamptz,
  add column if not exists calendar_cycle_key text;

comment on column public.elections.calendar_seated_at is
  'Set when calendar inauguration/midterm seating has processed this race (idempotent with roles_applied_at).';
comment on column public.elections.calendar_cycle_key is
  'Optional grouping key set when calendar creates races (e.g. midterms_2030, presidential_open_2031).';

-- Apply role transitions for a closed race (idempotent inside _apply_election_role_transitions).
create or replace function public.calendar_apply_election_role_transitions(p_election_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  perform public._apply_election_role_transitions(p_election_id);
end;
$$;

revoke all on function public.calendar_apply_election_role_transitions(uuid) from public;
grant execute on function public.calendar_apply_election_role_transitions(uuid) to service_role;

-- Open D/R party officer leadership window (chair/vice chair/treasurer) without admin auth — used by calendar cron.
create or replace function public.calendar_open_party_leadership_windows(p_hours int default 25)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  p text;
  ends timestamptz := now() + make_interval(hours => greatest(1, coalesce(p_hours, 25)));
begin
  foreach p in array array['democrat', 'republican']::text[]
  loop
    delete from public.party_officer_candidacies where party_key = p;
    delete from public.party_officer_votes where party_key = p;

    update public.party_organizations
    set
      leadership_phase = 'open',
      leadership_filing_ends_at = ends,
      leadership_voting_ends_at = null,
      updated_at = now()
    where party_key = p;
  end loop;

  return jsonb_build_object('ok', true, 'ends_at', ends);
end;
$$;

revoke all on function public.calendar_open_party_leadership_windows(int) from public;
grant execute on function public.calendar_open_party_leadership_windows(int) to service_role;

notify pgrst, 'reload schema';
