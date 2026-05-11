import Link from "next/link";
import {
  escalationHeat,
  heatBarBackgroundFromRelation,
  tierLabel,
  usRelationToTier,
} from "@/lib/diplomacy-escalation";

export type DiplomacyNationRow = { code: string; name: string; us_relation: number };

function sortedByHeat(nations: DiplomacyNationRow[]): DiplomacyNationRow[] {
  return [...nations].sort((a, b) => escalationHeat(b.us_relation) - escalationHeat(a.us_relation));
}

export function DiplomacyRiskHeatmap({
  nations,
  variant = "full",
  showStateLink = true,
}: {
  nations: DiplomacyNationRow[];
  variant?: "full" | "compact";
  showStateLink?: boolean;
}) {
  const rows = sortedByHeat(nations);

  if (variant === "compact") {
    return (
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
          Escalation watch (State tracker)
        </p>
        <div className="flex flex-wrap gap-2">
          {rows.map((n) => {
            const tier = usRelationToTier(n.us_relation);
            return (
              <div
                key={n.code}
                title={`${n.name}: ${n.us_relation}/100 — ${tierLabel(tier)}`}
                className="flex min-w-[8rem] max-w-[11rem] flex-1 flex-col gap-1 rounded border border-[var(--psc-border)] bg-white/50 px-2 py-1.5 text-[11px] shadow-sm"
              >
                <span className="truncate font-semibold text-[var(--psc-ink)]">{n.name}</span>
                <div className="h-2 w-full overflow-hidden rounded bg-black/10">
                  <div
                    className="h-full rounded transition-[width]"
                    style={{
                      width: `${escalationHeat(n.us_relation)}%`,
                      backgroundColor: heatBarBackgroundFromRelation(n.us_relation),
                    }}
                  />
                </div>
                <span className="font-mono text-[var(--psc-muted)]">{n.us_relation}</span>
              </div>
            );
          })}
        </div>
        {showStateLink ? (
          <p className="text-xs text-[var(--psc-muted)]">
            Only the Secretary of State can move these scores.{" "}
            <Link href="/cabinet/state" className="font-semibold text-[var(--psc-accent)] underline-offset-2 hover:underline">
              State desk →
            </Link>
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-[var(--psc-ink)]">Bilateral escalation heat</h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-[var(--psc-muted)]">
            Bars show pressure derived from standing (100 − relation). Defense uses this read-only picture with State
            to brief the principals.
          </p>
        </div>
        {showStateLink ? (
          <Link
            href="/cabinet/state"
            className="shrink-0 text-xs font-semibold text-[var(--psc-accent)] underline-offset-2 hover:underline"
          >
            State Department →
          </Link>
        ) : null}
      </div>
      <ul className="space-y-2">
        {rows.map((n) => {
          const tier = usRelationToTier(n.us_relation);
          const heat = escalationHeat(n.us_relation);
          return (
            <li
              key={n.code}
              className="rounded-lg border border-[var(--psc-border)] bg-white/40 px-3 py-2 shadow-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-[var(--psc-ink)]">{n.name}</p>
                  <p className="text-[11px] text-[var(--psc-muted)]">
                    <span className="font-mono">{n.us_relation}</span>/100 · {tierLabel(tier)}
                  </p>
                </div>
                <span className="font-mono text-xs text-[var(--psc-muted)]">heat {heat}</span>
              </div>
              <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-black/10">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${heat}%`,
                    backgroundColor: heatBarBackgroundFromRelation(n.us_relation),
                  }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
