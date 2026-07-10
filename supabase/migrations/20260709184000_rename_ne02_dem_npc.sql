-- Rename NE-02 Democratic NPC (slug ne-02-dem).

update public.sim_politicians
set character_name = 'Rep. Carmen Reyes'
where slug = 'ne-02-dem';
