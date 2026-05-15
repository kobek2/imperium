import Link from "next/link";
import { redirect } from "next/navigation";
import { DiplomacyRiskHeatmap } from "@/components/diplomacy-risk-heatmap";
import { MilitaryPowerLeaderboard } from "@/components/military-power-leaderboard";
import { canViewCabinetHub } from "@/lib/cabinet-hub";
import { cabinetDayStartIso } from "@/lib/cabinet-week";
import { usRelationToTier, tierLabel } from "@/lib/diplomacy-escalation";
import { loadDefenseProcurementOverview } from "@/lib/defense-procurement-budget";
import { militaryPowerSlices } from "@/lib/military-power";
import { selectDefenseWatchlistNations } from "@/lib/defense-ops-watchlist";
import { fetchEffectiveRoleKeys } from "@/lib/profile-roles";
import { getServerAuth } from "@/lib/supabase/server";

const cardClass =
  "rounded-lg border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5 shadow-sm";

function deptBodyNums(body: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(body)) {
    const n = Number(v);
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
}

export default async function SituationRoomNscPage() {
  const { supabase, user } = await getServerAuth();
  if (!supabase || !user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("office_role").eq("id", user.id).maybeSingle();
  const roleKeys = await fetchEffectiveRoleKeys(supabase, user.id, profile);
  if (!canViewCabinetHub(roleKeys)) redirect("/");

  const dayUtc = cabinetDayStartIso();
  const { error: tickErr } = await supabase.rpc("rp_diplomacy_daily_tick", { p_today: dayUtc });
  if (tickErr && !tickErr.message.toLowerCase().includes("schema cache")) {
    console.warn("[cabinet/nsc] rp_diplomacy_daily_tick:", tickErr.message);
  }
  const { error: milErr } = await supabase.rpc("rp_military_power_daily_tick", { p_today: dayUtc });
  if (milErr && !milErr.message.toLowerCase().includes("schema cache")) {
    console.warn("[cabinet/nsc] rp_military_power_daily_tick:", milErr.message);
  }

  const [{ data: nations, error: nErr }, { data: metrics, error: mErr }] = await Promise.all([
    supabase
      .from("rp_foreign_nations")
      .select("code, name, us_relation, power_ground, power_air, power_naval")
      .order("name", { ascending: true }),
    supabase.from("rp_cabinet_department_metrics").select("body").eq("portfolio_key", "defense").maybeSingle(),
  ]);

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
    return { code: n.code, name: n.name, ground: g, air: a, naval: v, total: g + a + v };
  });

  const critical = nationListFull.filter((n) => {
    const t = usRelationToTier(n.us_relation);
    return t === "critical" || t === "breakdown";
  });
  const rawBody = ((metrics as { body?: Record<string, unknown> } | null)?.body ?? {}) as Record<string, unknown>;
  const bodyNum = deptBodyNums(rawBody);
  const readiness = Number(bodyNum.readiness ?? 0);
  const logistics = Number(bodyNum.logistics_stress ?? 0);
  const exercises = Number(bodyNum.alliance_exercises_completed ?? 0);
  const usMil = militaryPowerSlices(bodyNum);
  const dataReady = !nErr && !mErr;

  const { error: procProbeErr } = await supabase.from("rp_defense_procurement_obligations").select("id").limit(1);
  const procurementLedgerReady = !procProbeErr;
  const procurementOverview = procurementLedgerReady
    ? await loadDefenseProcurementOverview(supabase, { recentLimit: 0 })
    : null;

  const fmtUsd = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
      Math.max(0, n),
    );

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">Cabinet</p>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--psc-ink)]">Situation Room briefing</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-[var(--psc-muted)]">
          Combined picture for principals: bilateral pressure from State&apos;s tracker, the military power scoreboard,
          and Defense readiness. Read-only here; Secretaries act from their desks.
        </p>
        <div className="flex flex-wrap gap-3 text-sm font-semibold">
          <Link href="/cabinet" className="text-[var(--psc-accent)] underline-offset-4 hover:underline">
            ← Cabinet overview
          </Link>
          <Link href="/cabinet/state" className="text-[var(--psc-accent)] underline-offset-4 hover:underline">
            State →
          </Link>
          <Link href="/cabinet/defense" className="text-[var(--psc-accent)] underline-offset-4 hover:underline">
            Defense →
          </Link>
        </div>
      </header>

      {!dataReady ? (
        <div className="rounded border border-amber-600 bg-amber-50 p-4 text-sm text-amber-950">
          NSC data not fully available. Apply the latest cabinet migrations (including{" "}
          <code className="font-mono">20260602120100_foreign_nations_military_power.sql</code> for power columns,{" "}
          <code className="font-mono">20260602131000_military_power_daily_tick.sql</code> for the daily +10 tick) and
          reload.
        </div>
      ) : null}

      {critical.length > 0 ? (
        <div className="rounded-lg border-2 border-amber-600 bg-amber-50 p-4 text-sm text-amber-950" role="status">
          <p className="font-semibold">Highest-priority partners</p>
          <p className="mt-1">
            {critical
              .map((n) => `${n.name} (${tierLabel(usRelationToTier(n.us_relation))}, ${n.us_relation}/100)`)
              .join(" · ")}
          </p>
        </div>
      ) : null}

      <section className={cardClass}>
        <DiplomacyRiskHeatmap nations={nationList} variant="full" />
        <p className="mt-2 text-xs text-[var(--psc-muted)]">
          Same seven-theater belt as the Secretary of Defense desk (Indo-Pacific, Europe, MENA, key allies).
        </p>
      </section>

      {dataReady ? (
        <MilitaryPowerLeaderboard usName="United States (Defense procurement)" usPower={usMil} peers={powerPeers} />
      ) : null}

      <section className={cardClass}>
        <h2 className="text-sm font-semibold text-[var(--psc-ink)]">Defense posture (global)</h2>
        <p className="mt-1 text-xs text-[var(--psc-muted)]">
          Snapshot from the Secretary of Defense dashboard — not auto-linked to diplomacy scores yet.
        </p>
        <dl className="mt-4 grid gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Readiness</dt>
            <dd className="font-mono text-2xl text-[var(--psc-ink)]">{readiness}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Logistics stress</dt>
            <dd className="font-mono text-2xl text-[var(--psc-ink)]">{logistics}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Alliance exercises</dt>
            <dd className="font-mono text-2xl text-[var(--psc-ink)]">{exercises}</dd>
          </div>
        </dl>
        {procurementOverview && procurementOverview.defenseCap > 0 ? (
          <p className="mt-4 rounded border border-[var(--psc-border)] bg-white/45 px-3 py-2 text-sm leading-relaxed text-[var(--psc-muted)]">
            <span className="font-semibold text-[var(--psc-ink)]">Defense line obligations ({procurementOverview.fiscalYearLabel}):</span>{" "}
            {fmtUsd(procurementOverview.obligatedTotal)} obligated of {fmtUsd(procurementOverview.defenseCap)} appropriated
            {procurementOverview.budgetSubmitted ? "" : " (budget not yet submitted — obligations locked)"}. Detail on the{" "}
            <Link href="/cabinet/defense" className="font-semibold text-[var(--psc-accent)] underline-offset-2 hover:underline">
              Defense desk
            </Link>
            .
          </p>
        ) : null}
      </section>

      <section className={`${cardClass} border-dashed`}>
        <h2 className="text-sm font-semibold text-[var(--psc-ink)]">RP prompts</h2>
        <ul className="mt-3 list-inside list-disc space-y-2 text-sm text-[var(--psc-muted)]">
          <li>President / Chief of Staff: convene a short thread using the heat list and defense snapshot.</li>
          <li>Secretary of State: passive desk time or intensive dialogue to recover standing on red partners.</li>
          <li>
            Secretary of Defense: obligate the defense appropriations line; use the military power scoreboard vs belt
            peers for narrative pacing.
          </li>
        </ul>
      </section>
    </div>
  );
}
