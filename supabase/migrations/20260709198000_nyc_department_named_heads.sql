-- NYC city department heads: five named figures with verified Wikimedia portrait URLs.

-- ---------- sim_politicians: dedicated department-head office ----------

alter table public.sim_politicians drop constraint if exists sim_politicians_office_check;
alter table public.sim_politicians add constraint sim_politicians_office_check
  check (office in ('house', 'senate', 'council', 'mayor', 'department_head'));

alter table public.sim_politicians drop constraint if exists sim_politicians_seat_shape;
alter table public.sim_politicians add constraint sim_politicians_seat_shape check (
  (office = 'house' and district_code is not null and state_code is null and senate_class is null and ward_code is null)
  or (office = 'senate' and district_code is null and state_code is not null and senate_class is not null and ward_code is null)
  or (office = 'council' and ward_code is not null and district_code is null and state_code is null and senate_class is null)
  or (office = 'mayor' and ward_code is null and district_code is null and state_code is null and senate_class is null)
  or (office = 'department_head' and ward_code is null and district_code is null and state_code is null and senate_class is null)
);

insert into public.sim_politicians (slug, character_name, party, bio, face_claim_url, office) values
  (
    'dept-finance-powell',
    'Jerome Powell',
    'democrat',
    'Former Federal Reserve Chair overseeing NYC revenue forecasting, bond issuance, and municipal audit compliance.',
    'https://upload.wikimedia.org/wikipedia/commons/9/92/Jerome_H._Powell%2C_Federal_Reserve_Chair.jpg',
    'department_head'
  ),
  (
    'dept-parks-knope',
    'Leslie Knope',
    'democrat',
    'Parks commissioner known for community gardens, rec-center upgrades, and aggressive grant-writing for greenway expansion.',
    'https://upload.wikimedia.org/wikipedia/commons/f/f9/Peabody_Poehler_2012_%28cropped%29.jpg',
    'department_head'
  ),
  (
    'dept-planning-mccord',
    'Elizabeth McCord',
    'democrat',
    'City planning director focused on zoning reform, waterfront resilience, and inclusive housing targets across the five boroughs.',
    'https://upload.wikimedia.org/wikipedia/commons/f/ff/T%C3%A9aLeoniJun07.jpg',
    'department_head'
  ),
  (
    'dept-police-pope',
    'Olivia Pope',
    'democrat',
    'Police commissioner balancing public-safety staffing, crisis-intervention teams, and community oversight protocols.',
    'https://upload.wikimedia.org/wikipedia/commons/3/35/Kerry_Washington_in_%282024%29_%28cropped%29.jpg',
    'department_head'
  ),
  (
    'dept-public-works-clinton',
    'Hillary Clinton',
    'democrat',
    'Public works chief directing street resurfacing, bridge maintenance, snow removal, and capital infrastructure delivery.',
    'https://upload.wikimedia.org/wikipedia/commons/2/27/Hillary_Clinton_official_Secretary_of_State_portrait_crop.jpg',
    'department_head'
  )
on conflict (slug) do update set
  character_name = excluded.character_name,
  party = excluded.party,
  bio = excluded.bio,
  face_claim_url = excluded.face_claim_url,
  office = excluded.office;

insert into public.city_department_heads (department_key, sim_politician_id) values
  ('finance', (select id from public.sim_politicians where slug = 'dept-finance-powell')),
  ('parks', (select id from public.sim_politicians where slug = 'dept-parks-knope')),
  ('planning', (select id from public.sim_politicians where slug = 'dept-planning-mccord')),
  ('police', (select id from public.sim_politicians where slug = 'dept-police-pope')),
  ('public_works', (select id from public.sim_politicians where slug = 'dept-public-works-clinton'))
on conflict (department_key) do update set
  sim_politician_id = excluded.sim_politician_id;
