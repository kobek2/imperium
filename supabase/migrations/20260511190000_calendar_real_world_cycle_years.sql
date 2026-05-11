-- Align calendar_cycle_key on seat races with real-world cadence (RP years):
--   inauguration January 2029 → midterms January 2031 → presidential January 2033.
-- Safe to run if no rows match (no-op).

update public.elections
set calendar_cycle_key = 'midterms_2031'
where calendar_cycle_key = 'midterms_2030';

update public.elections
set calendar_cycle_key = 'presidential_2033'
where calendar_cycle_key = 'presidential_2031';

comment on column public.elections.calendar_cycle_key is
  'Optional grouping key when calendar creates races (e.g. midterms_2031, presidential_2033).';

notify pgrst, 'reload schema';
