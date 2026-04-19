-- Staff admin: open D/R party officer (chair / vice chair / treasurer) filing without waiting for the RP schedule.

create or replace function public.party_admin_start_party_leadership_filing(p_party text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  org record;
begin
  if auth.uid() is null or not public.is_staff_admin(auth.uid()) then
    raise exception 'Admin only';
  end if;
  if p_party not in ('democrat', 'republican') then
    raise exception 'Invalid party';
  end if;

  select * into org from public.party_organizations where party_key = p_party for update;
  if not found then
    raise exception 'Party organization not found';
  end if;

  if org.leadership_phase = 'filing' then
    return jsonb_build_object('ok', true, 'event', 'already_filing', 'filing_ends_at', org.leadership_filing_ends_at);
  end if;

  if org.leadership_phase = 'voting' then
    raise exception 'Party is already in leadership voting. Let voting finish (or use per-office admin finalize) before opening a new filing window.';
  end if;

  delete from public.party_officer_candidacies where party_key = p_party;
  delete from public.party_officer_votes where party_key = p_party;

  update public.party_organizations
  set
    leadership_phase = 'filing',
    leadership_filing_ends_at = now() + interval '14 days',
    leadership_voting_ends_at = null,
    updated_at = now()
  where party_key = p_party;

  return jsonb_build_object(
    'ok', true,
    'event', 'filing_opened_admin',
    'filing_ends_at', (now() + interval '14 days')
  );
end;
$$;

grant execute on function public.party_admin_start_party_leadership_filing(text) to authenticated;

notify pgrst, 'reload schema';
