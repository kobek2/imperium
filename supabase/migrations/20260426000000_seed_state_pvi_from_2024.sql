-- Seed public.states.pvi with each state's 2024 presidential margin (Harris two-party
-- margin, rounded to a whole point). Positive = Democratic lean, negative = Republican lean.
--
-- Why this exists: `states.pvi` was added by 20260419000000 with `default 0`, and the server
-- action + _close_general_for_election() both use it as the Senate partisan lean. Without a
-- seed, every Senate race starts 50/50 because `partisan_lean := 0`. These values line up
-- with the approach `districts.pvi` already uses for House races.
--
-- Values are the ~two-party margin in percentage points from the 2024 Presidential election;
-- not a Cook PVI (PVI blends multiple cycles), but they meet the user's spec of "use the 2024
-- election leanings" and are easy to update later if desired.

update public.states as s
set pvi = v.pvi
from (values
  ('AL', -30),
  ('AK', -13),
  ('AZ',  -5),
  ('AR', -21),
  ('CA',  20),
  ('CO',  11),
  ('CT',  14),
  ('DE',  15),
  ('DC',  86),
  ('FL', -13),
  ('GA',  -2),
  ('HI',  24),
  ('ID', -37),
  ('IL',  11),
  ('IN', -19),
  ('IA', -13),
  ('KS', -16),
  ('KY', -31),
  ('LA', -22),
  ('ME',   7),
  ('MD',  26),
  ('MA',  25),
  ('MI',  -1),
  ('MN',   4),
  ('MS', -23),
  ('MO', -18),
  ('MT', -20),
  ('NE', -21),
  ('NV',  -3),
  ('NH',   3),
  ('NJ',   6),
  ('NM',   6),
  ('NY',  12),
  ('NC',  -3),
  ('ND', -36),
  ('OH', -11),
  ('OK', -33),
  ('OR',  14),
  ('PA',  -2),
  ('RI',  14),
  ('SC', -18),
  ('SD', -29),
  ('TN', -23),
  ('TX', -14),
  ('UT', -22),
  ('VT',  32),
  ('VA',   6),
  ('WA',  20),
  ('WV', -42),
  ('WI',  -1),
  ('WY', -46)
) as v(code, pvi)
where s.code = v.code;
