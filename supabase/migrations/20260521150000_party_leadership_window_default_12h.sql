-- Align SQL default with app: chamber/party leadership windows are 12h wall clock (see CALENDAR_LEADERSHIP_WINDOW_HOURS).

create or replace function public.calendar_open_party_leadership_windows(p_hours int default 12)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  p text;
  ends timestamptz := now() + make_interval(hours => greatest(1, coalesce(p_hours, 12)));
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
