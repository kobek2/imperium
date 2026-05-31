-- Idempotent: ensure only the 10 sim districts exist, all with zero lean.

delete from public.districts
where code !~ '^(NE|SO|WE)-[0-9]{2}$';

insert into public.states (code, name, region, senate_class, pvi) values
  ('NE', 'Northeast & Midwest', 'northeast_midwest', null, 0),
  ('SO', 'South', 'south', null, 0),
  ('WE', 'West', 'west', null, 0)
on conflict (code) do update set
  name = excluded.name,
  region = excluded.region,
  senate_class = excluded.senate_class,
  pvi = 0;

insert into public.districts (code, state, district_number, pvi, incumbent_party, incumbent_npc_name) values
  ('NE-01', 'NE', 1, 0, 'D', 'Open seat'),
  ('NE-02', 'NE', 2, 0, 'D', 'Open seat'),
  ('NE-03', 'NE', 3, 0, 'R', 'Open seat'),
  ('SO-01', 'SO', 1, 0, 'R', 'Open seat'),
  ('SO-02', 'SO', 2, 0, 'R', 'Open seat'),
  ('SO-03', 'SO', 3, 0, 'D', 'Open seat'),
  ('WE-01', 'WE', 1, 0, 'D', 'Open seat'),
  ('WE-02', 'WE', 2, 0, 'D', 'Open seat'),
  ('WE-03', 'WE', 3, 0, 'R', 'Open seat'),
  ('WE-04', 'WE', 4, 0, 'D', 'Open seat')
on conflict (code) do update set
  state = excluded.state,
  district_number = excluded.district_number,
  pvi = 0,
  incumbent_party = excluded.incumbent_party,
  incumbent_npc_name = excluded.incumbent_npc_name;

update public.profiles p
set home_district_code = d.code
from public.districts d
where upper(trim(coalesce(p.home_district_code, ''))) !~ '^(NE|SO|WE)-[0-9]{2}$'
  and d.state = upper(trim(coalesce(p.residence_state, '')))
  and d.district_number = 1;

notify pgrst, 'reload schema';
