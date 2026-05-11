-- Presidential calendar_cycle_key: use U.S. **election year** 2032 (Nov 2032), not inauguration year 2033.
-- Matches app keys presidential_election_open_2032 / presidential_seated_2032.

update public.elections
set calendar_cycle_key = 'presidential_2032'
where calendar_cycle_key = 'presidential_2033';

comment on column public.elections.calendar_cycle_key is
  'Optional grouping key when calendar creates races (e.g. midterms_2030, presidential_2032).';

notify pgrst, 'reload schema';
