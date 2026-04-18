-- Cabinet confirmations: store which government_role_grants.role_key to award, and
-- finalize via SECURITY DEFINER RPC (RLS blocks normal clients from inserting grants).

alter table public.appointments
  add column if not exists granted_role_key text;

comment on column public.appointments.granted_role_key is
  'For cabinet nominations: role_key inserted into government_role_grants when the Senate confirms.';

create or replace function public.apply_appointment_confirmation(p_bill_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  appt record;
  v_yea int := 0;
  v_nay int := 0;
  senate_size int := 0;
  need int;
begin
  select a.* into appt
  from public.appointments a
  where a.confirmation_bill_id = p_bill_id
    and a.status = 'pending'
  limit 1;

  if not found then
    return;
  end if;

  select
    count(*) filter (where vote = 'yea'),
    count(*) filter (where vote = 'nay')
  into v_yea, v_nay
  from public.bill_votes
  where bill_id = p_bill_id and chamber = 'senate';

  select count(distinct g.user_id)::int into senate_size
  from public.government_role_grants g
  where g.role_key in (
    'senator',
    'president_pro_tempore',
    'senate_majority_leader',
    'senate_majority_whip',
    'senate_minority_leader',
    'senate_minority_whip',
    'vice_president'
  );

  if senate_size is null or senate_size < 1 then
    need := 1;
  else
    need := ceiling(senate_size::numeric / 2)::int;
  end if;

  if coalesce(v_yea, 0) >= need and coalesce(v_yea, 0) > coalesce(v_nay, 0) then
    if appt.kind = 'cabinet'::public.appointment_kind
       and appt.granted_role_key is not null
       and length(trim(appt.granted_role_key)) > 0
    then
      delete from public.government_role_grants g
      where g.role_key = appt.granted_role_key;

      insert into public.government_role_grants (user_id, role_key)
      values (appt.nominee_user_id, appt.granted_role_key);
    end if;

    update public.appointments
      set status = 'confirmed'
      where id = appt.id;

    update public.bills
      set status = 'law'::public.bill_status,
          signed_at = coalesce(signed_at, now()),
          chamber_vote_deadline_at = null
      where id = p_bill_id;
  else
    update public.appointments
      set status = 'rejected'
      where id = appt.id;

    update public.bills
      set status = 'dead'::public.bill_status,
          chamber_vote_deadline_at = null
      where id = p_bill_id;
  end if;
end;
$$;

revoke all on function public.apply_appointment_confirmation(uuid) from public;
grant execute on function public.apply_appointment_confirmation(uuid) to authenticated;
grant execute on function public.apply_appointment_confirmation(uuid) to service_role;
