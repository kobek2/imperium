-- Midterm calendar_cycle_key and naming: use U.S. **election year** (2030), not the January RP year
-- when the sim opens filings (RP January 2031). Matches app keys midterms_open_2030 / midterms_seated_2030.

update public.elections
set calendar_cycle_key = 'midterms_2030'
where calendar_cycle_key = 'midterms_2031';

comment on column public.elections.calendar_cycle_key is
  'Optional grouping key when calendar creates races (e.g. midterms_2030 = 2030 U.S. midterm election cycle, presidential_2033).';

notify pgrst, 'reload schema';
