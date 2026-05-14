import Link from "next/link";
import { redirect } from "next/navigation";
import { DiplomacyRiskHeatmap } from "@/components/diplomacy-risk-heatmap";
import { canViewCabinetHub } from "@/lib/cabinet-hub";
import { cabinetDayStartIso } from "@/lib/cabinet-week";
import {
  DEFENSE_FOCUS_STYLE_OPTIONS,
  DEFENSE_PRIORITY_TIER_LABELS,
  isDefenseTheaterMechanism,
} from "@/lib/defense-theater";
import { usRelationToTier, tierLabel } from "@/lib/diplomacy-escalation";
import { loadDefenseProcurementOverview } from "@/lib/defense-procurement-budget";
import { fetchEffectiveRoleKeys } from "@/lib/profile-roles";
import { getServerAuth } from "@/lib/supabase/server";

const cardClass =
  "rounded-lg border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5 shadow-sm";

type DefenseBody = {
  readiness?: number;
  logistics_stress?: number;
  alliance_exercises_completed?: number;
};

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

  const [{ data: nations, error: nErr }, { data: metrics, error: mErr }, { data: postureRows, error: postureErr }] =
    await Promise.all([
      supabase.from("rp_foreign_nations").select("code, name, us_relation").order("name", { ascending: true }),
      supabase.from("rp_cabinet_department_metrics").select("body").eq("portfolio_key", "defense").maybeSingle(),
      supabase
        .from("rp_defense_theater_posture")
        .select("nation_code, priority_tier, forward_presence_level, primary_mechanism, theater_brief")
        .order("priority_tier", { ascending: true })
        .order("forward_presence_level", { ascending: false }),
    ]);

  const nationList = (nations ?? []) as Array<{ code: string; name: string; us_relation: number }>;
  const nationNameByCode = new Map(nationList.map((n) => [n.code, n.name]));
  const postureList = (postureRows ?? []) as Array<{
    nation_code: string;
    priority_tier: number;
    forward_presence_level: number;
    primary_mechanism: string;
    theater_brief: string;
  }>;
  const postureSorted = [...postureList].sort((a, b) => {
    if (a.priority_tier !== b.priority_tier) return a.priority_tier - b.priority_tier;
    if (b.forward_presence_level !== a.forward_presence_level) return b.forward_presence_level - a.forward_presence_level;
    return (nationNameByCode.get(a.nation_code) ?? a.nation_code).localeCompare(
      nationNameByCode.get(b.nation_code) ?? b.nation_code,
    );
  });
  const postureTop = postureSorted.slice(0, 14);
  const critical = nationList.filter((n) => {
    const t = usRelationToTier(n.us_relation);
    return t === "critical" || t === "breakdown";
  });
  const body = ((metrics as { body?: DefenseBody } | null)?.body ?? {}) as DefenseBody;
  const readiness = Number(body.readiness ?? 0);
  const logistics = Number(body.logistics_stress ?? 0);
  const exercises = Number(body.alliance_exercises_completed ?? 0);
  const dataReady = !nErr && !mErr && !postureErr;

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
          Combined picture for principals: bilateral pressure from State&apos;s tracker and Defense posture for RP
          threads. This page is read-only; Secretaries act from their department desks.
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
          NSC data not fully available. Apply migrations through{" "}
          <code className="font-mono">20260526100000_defense_theater_posture.sql</code> (and earlier cabinet diplomacy
          migrations). For defense procurement totals, also apply{" "}
          <code className="font-mono">20260527100000_defense_procurement_obligations.sql</code>.
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
      </section>

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

      {postureTop.length > 0 ? (
        <section className={cardClass}>
          <h2 className="text-sm font-semibold text-[var(--psc-ink)]">Global focus (SecDef)</h2>
          <p className="mt-1 text-xs text-[var(--psc-muted)]">
            Highest-priority theaters by tier and forward presence index — edit on the Defense desk.
          </p>
          <ul className="mt-4 space-y-3">
            {postureTop.map((p) => {
              const tier = p.priority_tier === 1 || p.priority_tier === 2 || p.priority_tier === 3 ? p.priority_tier : 3;
              const mechLabel =
                DEFENSE_FOCUS_STYLE_OPTIONS.find((o) => o.mechanism === p.primary_mechanism)?.label ??
                (isDefenseTheaterMechanism(p.primary_mechanism) ? p.primary_mechanism : p.primary_mechanism);
              const rawBrief = p.theater_brief ?? "";
              const brief = rawBrief.length > 220 ? `${rawBrief.slice(0, 220)}…` : rawBrief;
              return (
                <li
                  key={p.nation_code}
                  className="rounded-lg border border-[var(--psc-border)] bg-white/40 px-3 py-2 text-sm shadow-sm"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-semibold text-[var(--psc-ink)]">
                      {nationNameByCode.get(p.nation_code) ?? p.nation_code}
                    </span>
                    <span className="font-mono text-xs text-[var(--psc-muted)]">
                      Tier {tier} · {DEFENSE_PRIORITY_TIER_LABELS[tier]} · presence {p.forward_presence_level}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--psc-muted)]">{mechLabel}</p>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--psc-ink)]">{brief || "—"}</p>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section className={`${cardClass} border-dashed`}>
        <h2 className="text-sm font-semibold text-[var(--psc-ink)]">RP prompts</h2>
        <ul className="mt-3 list-inside list-disc space-y-2 text-sm text-[var(--psc-muted)]">
          <li>President / Chief of Staff: convene a short thread using the heat list and defense snapshot.</li>
          <li>Secretary of State: passive desk time or intensive dialogue to recover standing on red partners.</li>
          <li>
            Secretary of Defense: obligate the defense appropriations line (tanks, mobility, missiles, modernization) and
            align theater directives with State&apos;s heat list.
          </li>
        </ul>
      </section>
    </div>
  );
}
