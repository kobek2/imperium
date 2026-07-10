-- NYC council: seven named national-figure incumbents (4D / 3R) with official portrait URLs.

-- ---------- Seated council incumbents (sim_politicians) ----------

update public.sim_politicians set
  character_name = 'Kamala Harris',
  party = 'democrat',
  bio = 'Former Vice President and U.S. Senator seated on the Lower Manhattan council district; focuses on housing justice, small-business recovery, and civil-rights enforcement.',
  face_claim_url = 'https://upload.wikimedia.org/wikipedia/commons/4/41/Kamala_Harris_Vice_Presidential_Portrait.jpg'
where slug = 'w01-dem';

update public.sim_politicians set
  character_name = 'Zohran Mamdani',
  party = 'democrat',
  bio = 'State assembly member and democratic-socialist voice for Upper Manhattan; campaigns on rent stabilization, transit equity, and tenant protections.',
  face_claim_url = 'https://upload.wikimedia.org/wikipedia/commons/3/37/Zohran_Mamdani_05.25.25_%283x4_cropped%29.jpg'
where slug = 'w02-dem';

update public.sim_politicians set
  character_name = 'Gavin Newsom',
  party = 'democrat',
  bio = 'California governor known for climate and public-health leadership, now representing Southwest Brooklyn on zoning reform and waterfront resilience.',
  face_claim_url = 'https://upload.wikimedia.org/wikipedia/commons/2/20/Gavin_Newsom_official_photo.jpg'
where slug = 'w03-dem';

update public.sim_politicians set
  character_name = 'Alexandria Ocasio-Cortez',
  party = 'democrat',
  bio = 'U.S. Representative for New York''s 14th district; North Brooklyn council seat centered on Green New Deal policy, labor rights, and affordable housing.',
  face_claim_url = 'https://upload.wikimedia.org/wikipedia/commons/4/4a/Alexandria_Ocasio-Cortez_Official_Portrait.jpg'
where slug = 'w04-dem';

update public.sim_politicians set
  character_name = 'Marco Rubio',
  party = 'republican',
  bio = 'U.S. Senator and foreign-policy hawk holding the Southeast Queens council seat on fiscal restraint, charter-school expansion, and public safety.',
  face_claim_url = 'https://upload.wikimedia.org/wikipedia/commons/e/eb/Senator_Rubio_official_portrait.jpg'
where slug = 'w05-rep';

update public.sim_politicians set
  character_name = 'Mike Johnson',
  party = 'republican',
  bio = 'Speaker of the U.S. House representing the South Bronx council district; emphasizes faith-based outreach, law-enforcement support, and budget discipline.',
  face_claim_url = 'https://upload.wikimedia.org/wikipedia/commons/b/b9/Mike_Johnson_official_portrait%2C_118th_Congress.jpg'
where slug = 'w06-rep';

update public.sim_politicians set
  character_name = 'Donald Trump',
  party = 'republican',
  bio = 'Former U.S. President and Staten Island North Shore council member; platform centers on property-tax relief, deregulation, and infrastructure investment.',
  face_claim_url = 'https://upload.wikimedia.org/wikipedia/commons/5/56/Donald_Trump_official_portrait.jpg'
where slug = 'w07-rep';

-- Generic opposing-party challengers (election NPCs)
update public.sim_politicians set
  character_name = 'Republican Challenger (W01)',
  bio = 'Conservative attorney challenging Lower Manhattan on commercial zoning and NYPD staffing levels.'
where slug = 'w01-rep';

update public.sim_politicians set
  character_name = 'Republican Challenger (W02)',
  bio = 'Harlem small-business owner running on charter schools and property-tax caps.'
where slug = 'w02-rep';

update public.sim_politicians set
  character_name = 'Republican Challenger (W03)',
  bio = 'Brooklyn developer advocating streamlined permits and waterfront parking reform.'
where slug = 'w03-rep';

update public.sim_politicians set
  character_name = 'Republican Challenger (W04)',
  bio = 'North Brooklyn restaurateur campaigning on public safety and sanitation enforcement.'
where slug = 'w04-rep';

update public.sim_politicians set
  character_name = 'Democratic Challenger (W05)',
  bio = 'Queens community-board chair pushing transit upgrades and immigrant-services funding.'
where slug = 'w05-dem';

update public.sim_politicians set
  character_name = 'Democratic Challenger (W06)',
  bio = 'Bronx teacher-union organizer running on class-size relief and affordable-housing bonds.'
where slug = 'w06-dem';

update public.sim_politicians set
  character_name = 'Democratic Challenger (W07)',
  bio = 'Staten Island nurse advocating ferry expansion and coastal-resilience spending.'
where slug = 'w07-dem';

-- ---------- Wards: 4D / 3R composition + PVI ----------

update public.wards set
  pvi = case code
    when 'W01' then 18
    when 'W02' then 32
    when 'W03' then 8
    when 'W04' then 28
    when 'W05' then -6
    when 'W06' then -4
    when 'W07' then -12
    else pvi
  end,
  incumbent_party = case code
    when 'W05' then 'R'
    when 'W06' then 'R'
    when 'W07' then 'R'
    else 'D'
  end,
  incumbent_npc_name = case code
    when 'W01' then 'Kamala Harris'
    when 'W02' then 'Zohran Mamdani'
    when 'W03' then 'Gavin Newsom'
    when 'W04' then 'Alexandria Ocasio-Cortez'
    when 'W05' then 'Marco Rubio'
    when 'W06' then 'Mike Johnson'
    when 'W07' then 'Donald Trump'
    else incumbent_npc_name
  end
where city_code = 'MB';

-- Link incumbents to seated NPC rows
update public.wards w set
  incumbent_politician_id = sp.id,
  incumbent_npc_name = sp.character_name
from public.sim_politicians sp
where w.city_code = 'MB'
  and sp.office = 'council'
  and sp.ward_code = w.code
  and sp.party = case w.incumbent_party when 'D' then 'democrat' when 'R' then 'republican' end;

-- Refresh council caucus from updated ward incumbents
select public.bootstrap_campaign_caucus();

notify pgrst, 'reload schema';
