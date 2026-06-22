-- Production push: turn off economy dev mode (free PAC, budget bypass, wallet grants).

update public.simulation_settings
set economy_dev_mode = false,
    updated_at = now()
where id = 1;

comment on column public.simulation_settings.economy_dev_mode is
  'When true: PAC registration is free and budget gates are skipped. Keep false in production; enable manually for local testing only.';
