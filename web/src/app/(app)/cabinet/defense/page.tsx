import Link from "next/link";
import { redirect } from "next/navigation";
import { DefenseCommandCenterShell } from "@/components/defense-command-center";
import { DefenseProcurementPanel } from "@/components/defense-procurement-panel";
import { DiplomacyRiskHeatmap } from "@/components/diplomacy-risk-heatmap";
import { MilitaryPowerLeaderboard } from "@/components/military-power-leaderboard";
import { canActAsSecretaryOfDefense, canViewDefenseDepartment } from "@/lib/cabinet-hub";
import { cabinetDayStartIso } from "@/lib/cabinet-week";
import { loadDefenseProcurementOverview } from "@/lib/defense-procurement-budget";
import { militaryPowerSlices } from "@/lib/military-power";
import { selectDefenseWatchlistNations } from "@/lib/defense-ops-watchlist";
import { fetchEffectiveRoleKeys } from "@/lib/profile-roles";
import { getServerAuth } from "@/lib/supabase/server";

function deptBodyNums(body: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(body)) {
    const n = Number(v);
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
}

export default async function DefenseCabinetPage() {
  const { supabase, user } = await getServerAuth();
  if (!supabase || !user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("office_role").eq("id", user.id).maybeSingle();
  const roleKeys = await fetchEffectiveRoleKeys(supabase, user.id, profile);
  if (!canViewDefenseDepartment(roleKeys)) redirect("/");

  const canAct = canActAsSecretaryOfDefense(roleKeys);
  const dayUtc = cabinetDayStartIso();
  const { error: milTickErr } = await supabase.rpc("rp_military_power_daily_tick", { p_today: dayUtc });
  if (milTickErr && !milTickErr.message.toLowerCase().includes("schema cache")) {
    console.warn("[cabinet/defense] rp_military_power_daily_tick:", milTickErr.message);
  }
  const [{ data: metrics, error: mErr }, { data: nations, error: dipErr }] = await Promise.all([
    supabase.from("rp_cabinet_department_metrics").select("body").eq("portfolio_key", "defense").maybeSingle(),
    supabase
      .from("rp_foreign_nations")
      .select("code, name, us_relation, power_ground, power_air, power_naval")
      .order("name", { ascending: true }),
  ]);

  const rawBody = ((metrics as { body?: Record<string, unknown> } | null)?.body ?? {}) as Record<string, unknown>;
  const bodyNum = deptBodyNums(rawBody);
  const usMil = militaryPowerSlices(bodyNum);

  const nationListFull = (nations ?? []) as Array<{
    code: string;
    name: string;
    us_relation: number;
    power_ground?: number;
    power_air?: number;
    power_naval?: number;
  }>;
  const nationList = selectDefenseWatchlistNations(nationListFull);
  const powerPeers = nationList.map((n) => {
    const g = Number(n.power_ground ?? 0);
    const a = Number(n.power_air ?? 0);
    const v = Number(n.power_naval ?? 0);
    return {
      code: n.code,
      name: n.name,
      ground: g,
      air: a,
      naval: v,
      total: g + a + v,
    };
  });

  const dataReady = !mErr && !dipErr;

  const { error: procProbeErr } = await supabase.from("rp_defense_procurement_obligations").select("id").limit(1);
  const procurementLedgerReady = !procProbeErr;
  const procurementOverview = procurementLedgerReady
    ? await loadDefenseProcurementOverview(supabase, { recentLimit: 10 })
    : null;

  return (
    <div className="space-y-6">
      <DefenseCommandCenterShell
        title="Operations control"
        subtitle="Escalation belt, military power scoreboard, and the congressional defense wallet — cinematic RP, not a classified feed."
      >
        {!dataReady ? (
          <div className="rounded-xl border border-amber-600 bg-amber-50 p-4 text-sm text-amber-950">
            Defense desk data missing. Apply cabinet diplomacy migrations and reload.
          </div>
        ) : null}

        {dataReady ? (
          <MilitaryPowerLeaderboard
            usName="United States (your procurement)"
            usPower={usMil}
            peers={powerPeers}
          />
        ) : null}

        {nationList.length > 0 ? (
          <section className="rounded-2xl border border-[var(--psc-border)] bg-white/40 p-4 shadow-sm backdrop-blur-sm">
            <DiplomacyRiskHeatmap
              nations={nationList}
              variant="compact"
              compactTitle="Escalation watch (7 priority theaters)"
            />
            <p className="mt-3 text-xs text-[var(--psc-muted)]">
              Same strip as the{" "}
              <Link href="/cabinet/nsc" className="font-semibold text-[var(--psc-accent)] underline-offset-2 hover:underline">
                Situation Room
              </Link>
              . State owns the numbers — you react to them.
            </p>
          </section>
        ) : null}

        <DefenseProcurementPanel
          overview={procurementOverview}
          procurementLedgerReady={procurementLedgerReady}
          canAct={canAct}
          defenseBody={rawBody}
        />

        <div className="flex flex-wrap gap-3 text-sm font-semibold">
          <Link href="/cabinet" className="text-[var(--psc-accent)] underline-offset-4 hover:underline">
            ← Cabinet overview
          </Link>
          <Link href="/cabinet/nsc" className="text-[var(--psc-accent)] underline-offset-4 hover:underline">
            Situation Room →
          </Link>
        </div>
      </DefenseCommandCenterShell>
    </div>
  );
}
