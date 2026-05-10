-- Lighter default State roster: seven core partners (was seventeen in the original diplomacy seed).
-- Safe on DBs that already ran the larger insert: drop sessions tied to removed codes, then trim nations.

delete from public.rp_diplomatic_sessions
where nation_code not in ('GBR', 'CAN', 'MEX', 'JPN', 'UKR', 'RUS', 'CHN');

delete from public.rp_foreign_nations
where code not in ('GBR', 'CAN', 'MEX', 'JPN', 'UKR', 'RUS', 'CHN');
