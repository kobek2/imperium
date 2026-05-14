-- Defense theater posture: Secretary of Defense directs abstract forward presence &
-- primary mechanisms by country (aligned with rp_foreign_nations / State bilateral scores).

create table if not exists public.rp_defense_theater_posture (
  nation_code text primary key references public.rp_foreign_nations (code) on delete cascade,
  priority_tier smallint not null default 2 check (priority_tier between 1 and 3),
  forward_presence_level smallint not null default 20 check (forward_presence_level between 0 and 100),
  primary_mechanism text not null default 'forward_presence' check (
    primary_mechanism in (
      'advise_and_assist',
      'joint_training_exercise',
      'forward_presence',
      'maritime_security_patrol',
      'air_component_operations',
      'integrated_air_missile_defense',
      'security_force_assistance',
      'counterterror_support',
      'humanitarian_assistance',
      'cyber_defense_cooperation',
      'logistics_enabler_access'
    )
  ),
  theater_brief text not null default '' check (char_length(theater_brief) <= 4000),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

comment on table public.rp_defense_theater_posture is
  'Per-country defense posture for RP: abstract presence index and mechanism mix (not literal troop counts).';

create index if not exists rp_defense_theater_posture_tier_idx
  on public.rp_defense_theater_posture (priority_tier, forward_presence_level desc);

alter table public.rp_defense_theater_posture enable row level security;

drop policy if exists "rp_defense_theater_posture read cabinet" on public.rp_defense_theater_posture;
create policy "rp_defense_theater_posture read cabinet"
  on public.rp_defense_theater_posture for select
  to authenticated
  using (public._cabinet_portfolio_viewer(auth.uid()));

drop policy if exists "rp_defense_theater_posture insert secretary" on public.rp_defense_theater_posture;
create policy "rp_defense_theater_posture insert secretary"
  on public.rp_defense_theater_posture for insert
  to authenticated
  with check (public._cabinet_portfolio_secretary(auth.uid(), 'secretary_of_defense'));

drop policy if exists "rp_defense_theater_posture update secretary" on public.rp_defense_theater_posture;
create policy "rp_defense_theater_posture update secretary"
  on public.rp_defense_theater_posture for update
  to authenticated
  using (public._cabinet_portfolio_secretary(auth.uid(), 'secretary_of_defense'))
  with check (public._cabinet_portfolio_secretary(auth.uid(), 'secretary_of_defense'));

-- Broader real-world roster (State still owns us_relation; SoS edits unchanged).
insert into public.rp_foreign_nations (code, name, us_relation, last_decay_utc_date) values
  ('KOR', 'South Korea', 68, (timezone('UTC', now()))::date),
  ('TWN', 'Taiwan', 52, (timezone('UTC', now()))::date),
  ('ISR', 'Israel', 64, (timezone('UTC', now()))::date),
  ('DEU', 'Germany', 58, (timezone('UTC', now()))::date),
  ('POL', 'Poland', 62, (timezone('UTC', now()))::date),
  ('AUS', 'Australia', 72, (timezone('UTC', now()))::date),
  ('FRA', 'France', 55, (timezone('UTC', now()))::date),
  ('ITA', 'Italy', 52, (timezone('UTC', now()))::date),
  ('IND', 'India', 52, (timezone('UTC', now()))::date),
  ('IRN', 'Iran', 8, (timezone('UTC', now()))::date),
  ('IRQ', 'Iraq', 32, (timezone('UTC', now()))::date),
  ('SYR', 'Syria', 12, (timezone('UTC', now()))::date),
  ('PAK', 'Pakistan', 28, (timezone('UTC', now()))::date),
  ('EGY', 'Egypt', 38, (timezone('UTC', now()))::date),
  ('SAU', 'Saudi Arabia', 42, (timezone('UTC', now()))::date),
  ('NLD', 'Netherlands', 60, (timezone('UTC', now()))::date),
  ('NOR', 'Norway', 66, (timezone('UTC', now()))::date),
  ('ESP', 'Spain', 54, (timezone('UTC', now()))::date),
  ('BEL', 'Belgium', 56, (timezone('UTC', now()))::date),
  ('BRA', 'Brazil', 48, (timezone('UTC', now()))::date),
  ('COL', 'Colombia', 58, (timezone('UTC', now()))::date),
  ('PHL', 'Philippines', 56, (timezone('UTC', now()))::date),
  ('VNM', 'Vietnam', 50, (timezone('UTC', now()))::date),
  ('SGP', 'Singapore', 62, (timezone('UTC', now()))::date),
  ('NZL', 'New Zealand', 70, (timezone('UTC', now()))::date)
on conflict (code) do nothing;

-- Seed posture for every nation (SecDef can revise). Briefs are illustrative RP context, not operational orders.
insert into public.rp_defense_theater_posture (nation_code, priority_tier, forward_presence_level, primary_mechanism, theater_brief)
values
  ('GBR', 2, 35, 'joint_training_exercise', 'NATO interoperability, carrier strike group coordination, and intelligence fusion with UK counterparts.'),
  ('CAN', 2, 28, 'joint_training_exercise', 'NORAD continuity, Arctic awareness, and continental defense planning with Canadian forces.'),
  ('MEX', 3, 18, 'security_force_assistance', 'Counternarcotics and border-region security cooperation; limited advisory footprint.'),
  ('JPN', 1, 62, 'integrated_air_missile_defense', 'Treaty alliance; rotational forces, missile defense integration, and maritime denial under integrated deterrence.'),
  ('UKR', 1, 55, 'logistics_enabler_access', 'Security assistance pipeline, sustainment enablers, and training cells supporting Ukrainian defense capacity.'),
  ('RUS', 1, 40, 'forward_presence', 'EUCOM pacing challenge; enhanced forward presence, air policing, and deterrence messaging along the eastern flank.'),
  ('CHN', 1, 58, 'maritime_security_patrol', 'INDOPACOM pacing competition; freedom of navigation, alliance patrols, and undersea / surface sensing in the first island chain.'),
  ('KOR', 1, 72, 'integrated_air_missile_defense', 'Combined defense posture, readiness exercises, and extended deterrence alignment on the peninsula.'),
  ('TWN', 1, 45, 'maritime_security_patrol', 'Unofficial security cooperation, maritime domain awareness, and capability consultations consistent with policy guidance.'),
  ('ISR', 2, 38, 'joint_training_exercise', 'Missile defense cooperation, joint exercises, and counter-proliferation intelligence sharing.'),
  ('DEU', 2, 48, 'forward_presence', 'Permanent rotational presence, NATO force integration, and logistics hubs supporting Atlantic security.'),
  ('POL', 1, 52, 'forward_presence', 'Enhanced forward presence battle group, pre-positioned equipment, and rapid reinforcement planning.'),
  ('AUS', 2, 42, 'joint_training_exercise', 'AUKUS pathway work, amphibious interoperability, and Indo-Pacific logistics access.'),
  ('FRA', 2, 22, 'joint_training_exercise', 'NATO interoperability, African CT reach, and carrier strike coordination where missions overlap.'),
  ('ITA', 2, 20, 'logistics_enabler_access', 'Southern flank logistics, African maritime security support, and NATO air basing.'),
  ('IND', 2, 25, 'maritime_security_patrol', 'Malabar-tier exercises, maritime domain awareness in the Indian Ocean, and logistics agreements.'),
  ('IRN', 1, 22, 'maritime_security_patrol', 'Gulf maritime security, mine countermeasures readiness, and ISR posture against regional escalation.'),
  ('IRQ', 2, 30, 'advise_and_assist', 'Residual CT advise-and-assist cells and coalition sustainment for partner forces.'),
  ('SYR', 2, 12, 'counterterror_support', 'Limited counter-ISIS enabling presence; deconfliction channels and partner force support.'),
  ('PAK', 3, 10, 'counterterror_support', 'Counterterror cooperation where policy allows; constrained footprint relative to other South Asia priorities.'),
  ('EGY', 3, 16, 'security_force_assistance', 'Sinai peacekeeping support, counterterror training, and access for overflight / logistics.'),
  ('SAU', 2, 34, 'integrated_air_missile_defense', 'Gulf integrated air and missile defense architecture, patriots / THAAD coordination, and maritime security.'),
  ('NLD', 3, 14, 'logistics_enabler_access', 'NATO logistics nodes and mobility corridors for reinforcement into the eastern flank.'),
  ('NOR', 3, 12, 'joint_training_exercise', 'Arctic cold-weather training, host-nation support, and NATO northern flank readiness.'),
  ('ESP', 3, 12, 'logistics_enabler_access', 'Naval bases, air mobility staging, and NATO southern flank coordination.'),
  ('BEL', 3, 14, 'logistics_enabler_access', 'SHAPE-adjacent logistics, NATO headquarters support, and mobility corridors.'),
  ('BRA', 3, 8, 'humanitarian_assistance', 'Occasional humanitarian and peacekeeping interoperability; modest security cooperation.'),
  ('COL', 3, 20, 'counterterror_support', 'Plan Colombia legacy lines; counternarcotics aviation support and partner force training.'),
  ('PHL', 2, 40, 'maritime_security_patrol', 'EDCA sites, maritime patrols in the South China Sea, and alliance modernization.'),
  ('VNM', 3, 14, 'maritime_security_patrol', 'Coast guard capacity building and limited naval engagements in Southeast Asia.'),
  ('SGP', 2, 24, 'logistics_enabler_access', 'Logistics and sustainment hub for regional operations; port access and pre-positioning agreements.'),
  ('NZL', 3, 8, 'joint_training_exercise', 'Pacific partnership exercises and scientific / polar logistics cooperation.')
on conflict (nation_code) do nothing;

insert into public.rp_defense_theater_posture (nation_code, priority_tier, forward_presence_level, primary_mechanism, theater_brief)
select
  n.code,
  3,
  12,
  'joint_training_exercise',
  'Baseline security cooperation — align posture with State''s bilateral tracker and NSC guidance.'
from public.rp_foreign_nations n
where not exists (
  select 1 from public.rp_defense_theater_posture t where t.nation_code = n.code
);

notify pgrst, 'reload schema';
