-- elections_office_valid was never widened when mayor / council_ward were added to election_office.

alter table public.elections drop constraint if exists elections_office_valid;

alter table public.elections add constraint elections_office_valid check (
  (
    leadership_role is not null
    and state is null
    and district_code is null
    and senate_class is null
    and ward_code is null
    and office in ('house', 'senate')
  )
  or (
    leadership_role is null
    and (
      (office = 'house' and district_code is not null and state is not null and ward_code is null)
      or (office = 'senate' and state is not null and senate_class is not null and district_code is null and ward_code is null)
      or (office = 'president' and state is null and district_code is null and ward_code is null and senate_class is null)
      or (office = 'mayor' and state = 'MB' and district_code is null and ward_code is null and senate_class is null)
      or (office = 'council_ward' and ward_code is not null and state = 'MB' and district_code is null and senate_class is null)
    )
  )
);

notify pgrst, 'reload schema';
