/** Ordinance policy effects — mirrors SQL `_ordinance_sim_effect_deltas` for UI previews. */

export type CitySimEffectDeltas = {
  publicSafety: number;
  educationQuality: number;
  housingAffordability: number;
  businessClimate: number;
  mayorApproval: number;
  economyIndex: number;
  propertyTaxRatePct: number;
};

export type CitySimEffectEvent = {
  id: string;
  sourceType: string;
  sourceId: string | null;
  title: string;
  summary: string;
  effects: Record<string, unknown>;
  createdAt: string;
};

export const CITY_SIM_METRIC_LABELS: Record<
  keyof Omit<CitySimEffectDeltas, "propertyTaxRatePct">,
  string
> = {
  publicSafety: "Public safety",
  educationQuality: "Education",
  housingAffordability: "Housing affordability",
  businessClimate: "Business climate",
  mayorApproval: "Mayor approval",
  economyIndex: "Economy",
};

const EMPTY_DELTAS: CitySimEffectDeltas = {
  publicSafety: 0,
  educationQuality: 0,
  housingAffordability: 0,
  businessClimate: 0,
  mayorApproval: 0,
  economyIndex: 0,
  propertyTaxRatePct: 0,
};

function withDelta(base: CitySimEffectDeltas, patch: Partial<CitySimEffectDeltas>): CitySimEffectDeltas {
  return {
    publicSafety: base.publicSafety + (patch.publicSafety ?? 0),
    educationQuality: base.educationQuality + (patch.educationQuality ?? 0),
    housingAffordability: base.housingAffordability + (patch.housingAffordability ?? 0),
    businessClimate: base.businessClimate + (patch.businessClimate ?? 0),
    mayorApproval: base.mayorApproval + (patch.mayorApproval ?? 0),
    economyIndex: base.economyIndex + (patch.economyIndex ?? 0),
    propertyTaxRatePct: base.propertyTaxRatePct + (patch.propertyTaxRatePct ?? 0),
  };
}

/** Compute projected ordinance effects (keep in sync with migration SQL). */
export function computeOrdinanceEffectDeltas(
  category: string,
  issueKey: string,
  stanceKey: string,
): CitySimEffectDeltas {
  const cat = category.toLowerCase().trim();
  const issue = issueKey.toLowerCase().trim();
  const stance = stanceKey.toLowerCase().trim();
  let d = { ...EMPTY_DELTAS };

  if (cat === "taxes" && issue === "property_tax_rate") {
    if (stance === "progressive") {
      d = withDelta(d, {
        propertyTaxRatePct: -0.15,
        housingAffordability: 6,
        mayorApproval: 5,
        economyIndex: 2,
        businessClimate: -2,
      });
    } else if (stance === "conservative") {
      d = withDelta(d, {
        propertyTaxRatePct: 0.12,
        housingAffordability: -4,
        mayorApproval: -3,
        economyIndex: 1,
        businessClimate: 3,
      });
    }
  } else if (cat === "crime" && issue === "policing_community_programs") {
    if (stance === "progressive") {
      d = withDelta(d, {
        publicSafety: -3,
        mayorApproval: 6,
        housingAffordability: 2,
        educationQuality: 2,
      });
    } else if (stance === "moderate") {
      d = withDelta(d, { publicSafety: 2, mayorApproval: 1 });
    } else if (stance === "conservative") {
      d = withDelta(d, {
        publicSafety: 7,
        mayorApproval: -2,
        businessClimate: 2,
        housingAffordability: -1,
      });
    }
  } else if (cat === "economy" && issue === "small_business_permits") {
    if (stance === "progressive") {
      d = withDelta(d, { businessClimate: 5, mayorApproval: 3, economyIndex: 2 });
    } else if (stance === "conservative") {
      d = withDelta(d, { businessClimate: -4, mayorApproval: 2, housingAffordability: 1 });
    }
  } else if (cat === "economy" && issue === "minimum_wage") {
    if (stance === "progressive") {
      d = withDelta(d, {
        businessClimate: -7,
        housingAffordability: 5,
        mayorApproval: 4,
        economyIndex: -3,
      });
    } else if (stance === "moderate") {
      d = withDelta(d, {
        businessClimate: -2,
        housingAffordability: 3,
        mayorApproval: 2,
        economyIndex: -1,
      });
    } else if (stance === "conservative") {
      d = withDelta(d, { businessClimate: 3, housingAffordability: -2, mayorApproval: -2 });
    }
  } else if (cat === "education" && issue === "school_funding") {
    if (stance === "progressive") {
      d = withDelta(d, {
        educationQuality: 9,
        mayorApproval: 5,
        economyIndex: -2,
        businessClimate: -1,
      });
    } else if (stance === "moderate") {
      d = withDelta(d, { educationQuality: 2, mayorApproval: 1 });
    } else if (stance === "conservative") {
      d = withDelta(d, { educationQuality: -2, mayorApproval: -1, businessClimate: 2 });
    }
  } else {
    if (stance === "progressive") d = withDelta(d, { mayorApproval: 3, economyIndex: -1 });
    else if (stance === "conservative") d = withDelta(d, { mayorApproval: -2, businessClimate: 2 });
  }

  return d;
}

export function hasVisibleEffects(deltas: CitySimEffectDeltas): boolean {
  return (
    deltas.publicSafety !== 0 ||
    deltas.educationQuality !== 0 ||
    deltas.housingAffordability !== 0 ||
    deltas.businessClimate !== 0 ||
    deltas.mayorApproval !== 0 ||
    deltas.economyIndex !== 0 ||
    deltas.propertyTaxRatePct !== 0
  );
}

export function formatEffectDelta(value: number, suffix = ""): string {
  if (value === 0) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value}${suffix}`;
}

export function formatEffectLines(deltas: CitySimEffectDeltas): string[] {
  const lines: string[] = [];
  if (deltas.publicSafety !== 0) {
    lines.push(`Public safety ${formatEffectDelta(deltas.publicSafety)}`);
  }
  if (deltas.educationQuality !== 0) {
    lines.push(`Education ${formatEffectDelta(deltas.educationQuality)}`);
  }
  if (deltas.housingAffordability !== 0) {
    lines.push(`Housing affordability ${formatEffectDelta(deltas.housingAffordability)}`);
  }
  if (deltas.businessClimate !== 0) {
    lines.push(`Business climate ${formatEffectDelta(deltas.businessClimate)}`);
  }
  if (deltas.mayorApproval !== 0) {
    lines.push(`Mayor approval ${formatEffectDelta(deltas.mayorApproval)}`);
  }
  if (deltas.economyIndex !== 0) {
    lines.push(`Economy index ${formatEffectDelta(deltas.economyIndex)}`);
  }
  if (deltas.propertyTaxRatePct !== 0) {
    lines.push(`Property tax rate ${formatEffectDelta(deltas.propertyTaxRatePct, "%")}`);
  }
  return lines;
}

export function mapRawEffectDeltas(raw: Record<string, unknown>): CitySimEffectDeltas {
  return {
    publicSafety: Number(raw.public_safety ?? 0),
    educationQuality: Number(raw.education_quality ?? 0),
    housingAffordability: Number(raw.housing_affordability ?? 0),
    businessClimate: Number(raw.business_climate ?? 0),
    mayorApproval: Number(raw.mayor_approval ?? 0),
    economyIndex: Number(raw.economy_index ?? 0),
    propertyTaxRatePct: Number(raw.property_tax_rate_pct ?? 0),
  };
}

/** Rough budget enact effects for UI preview (mirrors `_apply_budget_sim_effects`). */
export function computeBudgetEffectPreview(
  departments: { departmentKey: string; amountMillions: number }[],
  deficitMillions: number,
): CitySimEffectDeltas {
  const baselines: Record<string, number> = {
    finance: 1200,
    police: 5800,
    public_works: 2500,
    parks: 700,
    planning: 150,
  };
  let d = { ...EMPTY_DELTAS };

  for (const dept of departments) {
    const baseline = baselines[dept.departmentKey] ?? 0;
    if (baseline <= 0) continue;
    const ratio = dept.amountMillions / baseline;
    const delta = ratio - 1;

    if (dept.departmentKey === "police") {
      d = withDelta(d, { publicSafety: Math.round(delta * 14) });
    } else if (dept.departmentKey === "public_works") {
      d = withDelta(d, {
        housingAffordability: Math.round(delta * 8),
        businessClimate: Math.round(delta * 4),
      });
    } else if (dept.departmentKey === "parks") {
      d = withDelta(d, {
        educationQuality: Math.round(delta * 6),
        mayorApproval: Math.round(delta * 3),
      });
    } else if (dept.departmentKey === "planning") {
      d = withDelta(d, { businessClimate: Math.round(delta * 10) });
    } else if (dept.departmentKey === "finance") {
      d = withDelta(d, { mayorApproval: Math.round(delta * 2) });
    }
  }

  if (deficitMillions < -500) {
    d = withDelta(d, { economyIndex: -4, mayorApproval: -5, businessClimate: -3 });
  } else if (deficitMillions > 150) {
    d = withDelta(d, { economyIndex: 2, mayorApproval: 2 });
  }

  return d;
}

export function metricTone(value: number): "good" | "mid" | "bad" {
  if (value >= 60) return "good";
  if (value >= 40) return "mid";
  return "bad";
}
