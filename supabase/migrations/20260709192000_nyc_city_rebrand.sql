-- Rebrand Millbrook seed rows to New York City display names.

update public.cities
set name = 'New York City', tagline = 'NYC city council + mayor simulation sandbox.'
where code = 'MB';

update public.states
set name = 'New York City'
where code = 'MB';

update public.wards set name = case code
  when 'W01' then 'Lower Manhattan & Financial District'
  when 'W02' then 'Upper Manhattan'
  when 'W03' then 'South Brooklyn'
  when 'W04' then 'North Brooklyn'
  when 'W05' then 'South Queens'
  when 'W06' then 'South Bronx'
  when 'W07' then 'Staten Island North'
  else name
end
where city_code = 'MB';

notify pgrst, 'reload schema';
