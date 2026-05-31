-- Run as staff in SQL editor (must be staff admin in profiles) or via app: Admin → Elections → Wipe all game history.
-- Applies the same logic as migration 20260627200000_admin_wipe_game_history.sql

select public.admin_wipe_game_history();
