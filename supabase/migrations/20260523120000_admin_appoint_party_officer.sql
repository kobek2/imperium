-- Staff (is_staff_admin): install or replace a D/R party officer (chair / vice_chair / treasurer) without an election.

create or replace function public.admin_appoint_party_officer(p_party text, p_office text, p_user_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  affil text;
begin
  if auth.uid() is null or not public.is_staff_admin(auth.uid()) then
    raise exception 'Admin only';
  end if;
  if p_party not in ('democrat', 'republican') then
    raise exception 'Invalid party.';
  end if;
  if p_office not in ('chair', 'vice_chair', 'treasurer') then
    raise exception 'Invalid office.';
  end if;

  select lower(trim(coalesce(p.party, ''))) into affil
  from public.profiles p
  where p.id = p_user_id;
  if affil is null or affil <> p_party then
    raise exception 'That profile must be affiliated with the selected party (Character party).';
  end if;

  delete from public.party_officer_votes where party_key = p_party and office = p_office;
  delete from public.party_officer_candidacies where party_key = p_party and office = p_office;

  insert into public.party_officers (party_key, office, user_id, since)
  values (p_party, p_office, p_user_id, now())
  on conflict (party_key, office) do update
  set user_id = excluded.user_id, since = excluded.since;

  return jsonb_build_object('ok', true, 'party', p_party, 'office', p_office, 'user_id', p_user_id);
end;
$$;

revoke all on function public.admin_appoint_party_officer(text, text, uuid) from public;
grant execute on function public.admin_appoint_party_officer(text, text, uuid) to authenticated;

notify pgrst, 'reload schema';
