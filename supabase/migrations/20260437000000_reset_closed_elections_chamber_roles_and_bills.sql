-- One-time sim reset: archived (closed) races, sitting House/Senate/Speaker assignments, and all bills.
-- Does not delete auth users or profiles; does not remove admin, president, VP, or other
-- leadership grants (majority/minority leaders, whips, president pro tempore).

-- Legislative pipeline (appointments.confirmation_bill_id is ON DELETE SET NULL).
delete from public.bills;

-- Chamber + Speaker from profile + grant tables (Discord may re-sync grants later).
update public.profiles
set office_role = null,
    updated_at = now()
where office_role in ('representative', 'senator', 'speaker');

delete from public.government_role_grants
where role_key in ('representative', 'senator', 'speaker');

-- Closed seat + leadership + presidential races; cascades candidates, votes, campaign rows, etc.
delete from public.elections
where phase = 'closed'::public.election_phase;
