-- New installs already use default now(); this aligns existing databases that still use a fixed 2026 default.
alter table public.simulation_settings
  alter column real_anchor_at set default now();
