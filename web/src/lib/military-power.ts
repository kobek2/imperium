import type { DefenseProcurementCategory } from "@/lib/defense-procurement-budget";

type DeptBody = Record<string, number>;

export const DEFENSE_MODERNIZE_SURCHARGE_USD = 100_000_000;

export const MILITARY_POWER_KEYS = {
  ground: "military_power_ground",
  air: "military_power_air",
  naval: "military_power_naval",
} as const;

/** Starting U.S. force posture in the scoreboard (SecDef spending adds on top). */
export const DEFAULT_US_MILITARY_POWER = { ground: 100, air: 200, naval: 200 } as const;

/** ~$100k of obligation → +1 power point before modernize doubling (tunable). */
export function procurementPowerPointsFromPackageUsd(packageUsd: number): number {
  return Math.max(0, Math.round(Number(packageUsd) / 100_000));
}

/** How a procurement lane splits its power gain across domains (sums to 1). */
export function militaryPowerWeightsForCategory(category: DefenseProcurementCategory): {
  ground: number;
  air: number;
  naval: number;
} {
  switch (category) {
    case "heavy_armor":
    case "cavalry_and_mobility":
      return { ground: 1, air: 0, naval: 0 };
    case "munitions_industrial_base":
      return { ground: 0.75, air: 0.25, naval: 0 };
    case "aviation_rotary":
      return { ground: 0, air: 1, naval: 0 };
    case "weapon_system_modernization":
      return { ground: 0.35, air: 0.65, naval: 0 };
    case "missiles_and_long_range_strike":
      return { ground: 0.1, air: 0.35, naval: 0.55 };
    default:
      return { ground: 0.34, air: 0.33, naval: 0.33 };
  }
}

function readPower(body: DeptBody, key: string, fallback: number): number {
  const v = Number(body[key]);
  return Number.isFinite(v) ? v : fallback;
}

export function militaryPowerSlices(body: DeptBody): {
  ground: number;
  air: number;
  naval: number;
  total: number;
} {
  const ground = readPower(body, MILITARY_POWER_KEYS.ground, DEFAULT_US_MILITARY_POWER.ground);
  const air = readPower(body, MILITARY_POWER_KEYS.air, DEFAULT_US_MILITARY_POWER.air);
  const naval = readPower(body, MILITARY_POWER_KEYS.naval, DEFAULT_US_MILITARY_POWER.naval);
  return { ground, air, naval, total: ground + air + naval };
}

/** Split integer `gain` across domains using largest-remainder so components sum to `gain`. */
function distributeIntegerGain(
  gain: number,
  w: { ground: number; air: number; naval: number },
): { ground: number; air: number; naval: number } {
  if (gain <= 0) return { ground: 0, air: 0, naval: 0 };
  const raw = {
    ground: gain * w.ground,
    air: gain * w.air,
    naval: gain * w.naval,
  };
  const base = {
    ground: Math.floor(raw.ground),
    air: Math.floor(raw.air),
    naval: Math.floor(raw.naval),
  };
  let rem = gain - (base.ground + base.air + base.naval);
  const order = [
    ["ground", raw.ground - base.ground] as const,
    ["air", raw.air - base.air] as const,
    ["naval", raw.naval - base.naval] as const,
  ].sort((a, b) => b[1] - a[1]);
  const out = { ...base };
  let i = 0;
  while (rem > 0) {
    const k = order[i % 3][0];
    if (k === "ground") out.ground += 1;
    if (k === "air") out.air += 1;
    if (k === "naval") out.naval += 1;
    rem -= 1;
    i += 1;
  }
  return out;
}

export function applyMilitaryPowerAfterProcurement(
  body: DeptBody,
  category: DefenseProcurementCategory,
  packageAmountUsd: number,
  modernize: boolean,
): DeptBody {
  const baseGain = procurementPowerPointsFromPackageUsd(packageAmountUsd);
  const gain = modernize ? baseGain * 2 : baseGain;
  const add = distributeIntegerGain(gain, militaryPowerWeightsForCategory(category));
  const cur = militaryPowerSlices(body);
  return {
    ...body,
    [MILITARY_POWER_KEYS.ground]: cur.ground + add.ground,
    [MILITARY_POWER_KEYS.air]: cur.air + add.air,
    [MILITARY_POWER_KEYS.naval]: cur.naval + add.naval,
  };
}
