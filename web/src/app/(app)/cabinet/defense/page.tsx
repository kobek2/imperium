import Link from "next/link";
import { redirect } from "next/navigation";
import { DefenseCommandCenterShell } from "@/components/defense-command-center";
import { DefenseProcurementPanel } from "@/components/defense-procurement-panel";
import { DefenseTheaterDirectivesPanel } from "@/components/defense-theater-directives-panel";
import type { TheaterDirectiveRow } from "@/components/defense-theater-directives-panel";
import { DiplomacyRiskHeatmap } from "@/components/diplomacy-risk-heatmap";
import { canActAsSecretaryOfDefense, canViewDefenseDepartment } from "@/lib/cabinet-hub";
import { loadDefenseProcurementOverview } from "@/lib/defense-procurement-budget";
import { fetchEffectiveRoleKeys } from "@/lib/profile-roles";
import { getServerAuth } from "@/lib/supabase/server";

type DefenseBody = {
  readiness?: number;
  logistics_stress?: number;
  alliance_exercises_completed?: number;
};

export default async function DefenseCabinetPage() {
  const { supabase, user } = await getServerAuth();
  if (!supabase || !user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("office_role").eq("id", user.id).maybeSingle();
  const roleKeys = await fetchEffectiveRoleKeys(supabase, user.id, profile);
  if (!canViewDefenseDepartment(roleKeys)) redirect("/");

  const canAct = canActAsSecretaryOfDefense(roleKeys);
  const [{ data: metrics, error: mErr }, { data: nations, error: dipErr }, { data: postureRows, error: postureErr }] =
    await Promise.all([
      supabase.from("rp_cabinet_department_metrics").select("body").eq("portfolio_key", "defense").maybeSingle(),
      supabase.from("rp_foreign_nations").select("code, name, us_relation").order("name", { ascending: true }),
      supabase
        .from("rp_defense_theater_posture")
        .select("nation_code, priority_tier, forward_presence_level, primary_mechanism, theater_brief, updated_at"),
    ]);

  const body = ((metrics as { body?: DefenseBody } | null)?.body ?? {}) as DefenseBody;
  const readiness = Number(body.readiness ?? 0);
  const logistics = Number(body.logistics_stress ?? 0);
  const exercises = Number(body.alliance_exercises_completed ?? 0);

  const nationList = (nations ?? []) as Array<{ code: string; name: string; us_relation: number }>;
  const postureByCode = new Map(
    (postureRows ?? []).map((r) => [
      String((r as { nation_code: string }).nation_code),
      r as {
        nation_code: string;
        priority_tier: number;
        forward_presence_level: number;
        primary_mechanism: string;
        theater_brief: string;
        updated_at: string | null;
      },
    ]),
  );
  const directiveRows: TheaterDirectiveRow[] = nationList.map((n) => {
    const p = postureByCode.get(n.code);
    return {
      nation_code: n.code,
      name: n.name,
      us_relation: Number(n.us_relation),
      priority_tier: p ? Number(p.priority_tier) : 3,
      forward_presence_level: p ? Number(p.forward_presence_level) : 15,
      primary_mechanism: p?.primary_mechanism ?? "joint_training_exercise",
      theater_brief: p?.theater_brief ?? "",
      updated_at: p?.updated_at ?? null,
    };
  });
  const dataReady = !mErr && !dipErr && !postureErr;

  const { error: procProbeErr } = await supabase.from("rp_defense_procurement_obligations").select("id").limit(1);
  const procurementLedgerReady = !procProbeErr;
  const procurementOverview = procurementLedgerReady
    ? await loadDefenseProcurementOverview(supabase, { recentLimit: 10 })
    : null;

  return (
    <div className="space-y-6">
      <DefenseCommandCenterShell
        title="Operations control"
        subtitle="Skim the diplomacy heat strip, move the global focus board, then go shopping with the congressional defense wallet. Built for fast, cinematic RP — not a real classified feed."
      >
        {!dataReady ? (
          <div className="rounded-xl border border-amber-600 bg-amber-50 p-4 text-sm text-amber-950">
            Defense desk data missing. Apply{" "}
            <code className="font-mono text-xs">20260526100000_defense_theater_posture.sql</code> plus earlier cabinet
            diplomacy migrations.
          </div>
        ) : null}

        {dataReady ? (
          <section className="rounded-2xl border border-[var(--psc-border)] bg-white/40 p-4 shadow-sm backdrop-blur-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Status boards</h2>
              <div className="flex flex-wrap gap-4 font-mono text-sm">
                <span className="text-[var(--psc-muted)]">
                  Readiness <strong className="text-[var(--psc-ink)]">{readiness}</strong>
                </span>
                <span className="text-[var(--psc-muted)]">
                  Logistics <strong className="text-[var(--psc-ink)]">{logistics}</strong>
                </span>
                <span className="text-[var(--psc-muted)]">
                  Drills <strong className="text-[var(--psc-ink)]">{exercises}</strong>
                </span>
              </div>
            </div>
          </section>
        ) : null}

        {nationList.length > 0 ? (
          <section className="rounded-2xl border border-[var(--psc-border)] bg-white/40 p-4 shadow-sm backdrop-blur-sm">
            <DiplomacyRiskHeatmap nations={nationList} variant="compact" />
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
        />

        {dataReady && directiveRows.length > 0 ? (
          <DefenseTheaterDirectivesPanel rows={directiveRows} canAct={canAct} />
        ) : null}

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
