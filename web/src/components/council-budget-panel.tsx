"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { councilBudgetVote, type MayorActionResult } from "@/app/actions/mayor";
import type { CityBudgetRow, CityOfficeData } from "@/lib/city-office-data";
import { formatFiscalMillions } from "@/lib/city-fiscal-data";
import {
  OrdinanceRollCallTable,
  ordinanceStatusLabel,
} from "@/components/ordinance-roll-call-table";

function formatDept(key: string): string {
  return key.replace(/_/g, " ");
}

function BudgetSummary({ budget }: { budget: CityBudgetRow }) {
  return (
    <div className="space-y-2 text-sm">
      <p className="font-medium text-[var(--psc-ink)]">
        FY{budget.fiscalYear}{" "}
        <span className="rounded border border-[var(--psc-border)] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--psc-muted)]">
          {ordinanceStatusLabel(budget.status)}
        </span>
        {budget.councilYeas + budget.councilNays > 0
          ? ` · ${budget.councilYeas}–${budget.councilNays}`
          : ""}
      </p>
      {budget.projectedDeficitMillions != null ? (
        <p className="text-xs text-[var(--psc-muted)]">
          Projected biennial balance: {formatFiscalMillions(budget.projectedDeficitMillions)}
        </p>
      ) : null}
      <ul className="text-[var(--psc-muted)]">
        {budget.lines.map((l) => (
          <li key={l.departmentKey}>
            {formatDept(l.departmentKey)}: {formatFiscalMillions(l.amountMillions)}
          </li>
        ))}
      </ul>
      {budget.rollCall.length > 0 ? <OrdinanceRollCallTable rows={budget.rollCall} /> : null}
    </div>
  );
}

export function CouncilBudgetPanel({ data, isAdmin }: { data: CityOfficeData; isAdmin: boolean }) {
  const canCouncil = data.isCouncilMember || isAdmin;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [flash, setFlash] = useState<MayorActionResult | null>(null);

  function run(fn: () => Promise<MayorActionResult>) {
    start(async () => {
      const result = await fn();
      setFlash(result);
      if (result.ok) router.refresh();
    });
  }

  return (
    <section className="space-y-4 rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
      {flash ? (
        <p
          className={`rounded border px-3 py-2 text-sm ${
            flash.ok
              ? "border-green-800/40 bg-green-950/30 text-green-200"
              : "border-red-800/40 bg-red-950/30 text-red-200"
          }`}
        >
          {flash.message}
        </p>
      ) : null}

      {data.pendingBudget ? (
        <div className="space-y-3 rounded border border-amber-400/40 bg-amber-50/50 p-3 dark:bg-amber-950/15">
          <p className="text-sm font-semibold text-[var(--psc-ink)]">Council vote open</p>
          <BudgetSummary budget={data.pendingBudget} />
          {data.pendingBudget.councilVoteClosesAt ? (
            <p className="text-xs font-medium text-amber-900">
              Council vote closes ~
              {new Date(data.pendingBudget.councilVoteClosesAt).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}{" "}
              (or when all player-held seats vote).
            </p>
          ) : null}
          {canCouncil ? (
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                disabled={pending}
                className="rounded border border-green-700 px-3 py-1.5 text-sm font-semibold text-green-800 disabled:opacity-50"
                onClick={() => run(() => councilBudgetVote(data.pendingBudget!.id, "yea"))}
              >
                Vote Yea
              </button>
              <button
                type="button"
                disabled={pending}
                className="rounded border border-red-800 px-3 py-1.5 text-sm font-semibold text-red-800 disabled:opacity-50"
                onClick={() => run(() => councilBudgetVote(data.pendingBudget!.id, "nay"))}
              >
                Vote Nay
              </button>
            </div>
          ) : (
            <p className="text-xs text-[var(--psc-muted)]">
              NPC-held council seats vote <strong className="text-[var(--psc-ink)]">yea automatically</strong> when
              the budget is finalized. Player-held seats must cast ballots first.
            </p>
          )}
        </div>
      ) : null}

      {data.awaitingMayorBudget ? (
        <div className="space-y-2 rounded border border-violet-400/40 bg-violet-50/40 p-3 dark:bg-violet-950/15">
          <p className="text-sm font-semibold text-[var(--psc-ink)]">Passed council — awaiting mayor signature</p>
          <BudgetSummary budget={data.awaitingMayorBudget} />
          <p className="text-xs text-[var(--psc-muted)]">
            The mayor must sign or veto on the Mayor&apos;s Office page before allocations take effect.
          </p>
        </div>
      ) : null}

      {!data.pendingBudget && !data.awaitingMayorBudget ? (
        <p className="text-sm text-[var(--psc-muted)]">No budget is pending council action right now.</p>
      ) : null}
    </section>
  );
}
