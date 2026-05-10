-- One-shot reset for local / staging testing: default bilateral scores + fresh daily hours + clear open dialogues.
-- Run in Supabase SQL editor (or: `psql $DATABASE_URL -f supabase/scripts/reset_diplomacy_for_testing.sql`).

begin;

-- Align roster with core seven (drops stray nation rows from older seeds).
delete from public.rp_diplomatic_sessions
where nation_code not in ('GBR', 'CAN', 'MEX', 'JPN', 'UKR', 'RUS', 'CHN');

delete from public.rp_foreign_nations
where code not in ('GBR', 'CAN', 'MEX', 'JPN', 'UKR', 'RUS', 'CHN');

update public.rp_foreign_nations
set
  us_relation = case code
    when 'GBR' then 82
    when 'CAN' then 78
    when 'MEX' then 62
    when 'JPN' then 70
    when 'UKR' then 78
    when 'RUS' then 22
    when 'CHN' then 30
    else us_relation
  end,
  last_decay_utc_date = (timezone('UTC', now()))::date,
  updated_at = now();

-- Full daily engagement budget back (all cabinet roles / users for this DB).
truncate public.cabinet_daily_hours;

-- Drop in-progress intensive rows so old session URLs do not linger.
delete from public.rp_diplomatic_sessions
where mode = 'intensive' and status = 'open';

commit;
