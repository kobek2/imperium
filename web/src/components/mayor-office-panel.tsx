"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ProfileImageWithFallback } from "@/components/profile-image-with-fallback";
import {
  assignDepartmentTask,
  closeDepartmentTask,
  mayorSignBudget,
  mayorSignOrdinance,
  mayorVetoBudget,
  mayorVetoOrdinance,
  requestDepartmentTaskUpdate,
  syncCouncilCaucus,
  type MayorActionResult,
} from "@/app/actions/mayor";
import type { CityOfficeData, DepartmentReportRow } from "@/lib/city-office-data";
import type { CityFiscalSnapshot } from "@/lib/city-fiscal-data";
import type { CityMetricsSnapshot } from "@/lib/city-metrics-data";
import { NYC_CITY_NAME } from "@/lib/city";
import { formatFiscalMillions } from "@/lib/city-fiscal-data";
import { CityHealthStrip } from "@/components/city-health-strip";
import { OrdinanceEffectPreview } from "@/components/ordinance-effect-preview";
import { BudgetEffectPreview } from "@/components/budget-effect-preview";
import {
  OrdinanceRollCallTable,
  ordinanceStatusLabel,
} from "@/components/ordinance-roll-call-table";
import { CitySimWeekBanner } from "@/components/city-sim-week-banner";
import { MayorDepartmentHeadsPanel } from "@/components/mayor-department-heads-panel";
import { MayorExecutiveOrdersPanel } from "@/components/mayor-executive-orders-panel";
import { MayorPublicStatementsPanel } from "@/components/mayor-public-statements-panel";
import type { CitySimWeekStatus } from "@/lib/city-sim-week";

function reportKindLabel(kind: string): string {
  switch (kind) {
    case "task_ack":
      return "Directive ack";
    case "task_update":
      return "Status update";
    case "situation":
      return "Situation report";
    case "vacancy":
      return "Vacancy";
    case "appointment":
      return "Appointment";
    default:
      return "Briefing";
  }
}

function formatReportTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function ReportCard({ report }: { report: DepartmentReportRow }) {
  const isVacancy = report.reportKind === "vacancy";
  return (
    <article
      className={`rounded border p-3 text-sm ${
        isVacancy
          ? "border-amber-400/70 bg-amber-50/70 dark:bg-amber-950/20"
          : "border-[var(--psc-border)] bg-[var(--psc-canvas)]"
      }`}
    >
      <div className="flex gap-3">
        <div className="h-10 w-10 shrink-0 overflow-hidden rounded bg-[var(--psc-panel)]">
          {isVacancy ? (
            <div className="flex h-full w-full items-center justify-center text-[10px] font-bold uppercase text-amber-800">
              Vacant
            </div>
          ) : (
            <ProfileImageWithFallback
              src={report.faceClaimUrl}
              name={report.headName}
              variant="portrait"
              initialClassName="flex h-full w-full items-center justify-center text-xs font-semibold text-[var(--psc-muted)]"
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-[var(--psc-ink)]">{report.headName}</p>
            <span className="rounded border border-[var(--psc-border)] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--psc-muted)]">
              {report.departmentLabel}
            </span>
            <span
              className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
                isVacancy
                  ? "border-amber-600 bg-amber-100 text-amber-900"
                  : "border-slate-300 bg-slate-50 text-slate-700"
              }`}
            >
              {reportKindLabel(report.reportKind)}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-[var(--psc-muted)]">{formatReportTime(report.createdAt)}</p>
          <p className="mt-2 font-medium text-[var(--psc-ink)]">{report.title}</p>
          <p className="mt-1 whitespace-pre-wrap text-[var(--psc-muted)]">{report.body}</p>
        </div>
      </div>
    </article>
  );
}

export function MayorOfficePanel({
  data,
  fiscal,
  metrics,
  simWeek,
  isAdmin,
}: {
  data: CityOfficeData;
  fiscal: CityFiscalSnapshot;
  metrics?: CityMetricsSnapshot;
  simWeek: CitySimWeekStatus;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [flash, setFlash] = useState<MayorActionResult | null>(null);
  const [signatureNote, setSignatureNote] = useState<
    { targetId: string; ok: boolean; message: string } | null
  >(null);
  const [taskDept, setTaskDept] = useState("finance");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskInstructions, setTaskInstructions] = useState("");

  function run(fn: () => Promise<MayorActionResult>, targetId?: string) {
    start(async () => {
      try {
        const result = await fn();
        setFlash(result);
        if (targetId) {
          setSignatureNote({ targetId, ok: result.ok, message: result.message });
        }
        if (result.ok) router.refresh();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Action failed.";
        setFlash({ ok: false, message });
        if (targetId) {
          setSignatureNote({ targetId, ok: false, message });
        }
      }
    });
  }

  const canMayor = data.isMayor || isAdmin;
  const hasPendingSignatures =
    Boolean(data.awaitingMayorBudget) || data.awaitingMayorOrdinances.length > 0;
  const selectedTaskDept = data.departments.find((d) => d.departmentKey === taskDept);
  const taskDeptVacant = Boolean(selectedTaskDept?.isVacant);

  return (
    <section className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-xl font-semibold">Mayor&apos;s Office · {NYC_CITY_NAME}</h1>
        <p className="max-w-2xl text-sm text-[var(--psc-muted)]">
          Sign passed legislation, read department briefings, and issue directives to your commissioners.
        </p>
      </header>

      <CitySimWeekBanner status={simWeek} />

      {flash ? (
        <p
          className={`rounded border px-3 py-2 text-sm ${
            flash.ok
              ? "border-green-700/30 bg-green-50 text-green-900"
              : "border-red-700/30 bg-red-50 text-red-900"
          }`}
        >
          {flash.message}
        </p>
      ) : null}

      <CityHealthStrip fiscal={fiscal} />

      <MayorDepartmentHeadsPanel
        canMayor={canMayor}
        departments={data.departments}
        appointableHeads={data.appointableDepartmentHeads}
        pending={pending}
        onRun={run}
      />

      <MayorPublicStatementsPanel
        canMayor={canMayor}
        statements={data.publicStatements}
        pending={pending}
        onRun={run}
      />

      <MayorExecutiveOrdersPanel
        canMayor={canMayor}
        orders={data.executiveOrders}
        pending={pending}
        onRun={run}
      />

      <div className="space-y-3 rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
        <h2 className="font-semibold">Pending signatures</h2>
        <p className="text-xs text-[var(--psc-muted)]">
          Council-passed budgets and ordinances await your signature or veto.
        </p>

        {flash ? (
          <p
            className={`rounded border px-3 py-2 text-sm ${
              flash.ok
                ? "border-green-700/30 bg-green-50 text-green-900"
                : "border-red-700/30 bg-red-50 text-red-900"
            }`}
          >
            {flash.message}
          </p>
        ) : null}

        {data.pendingBudget ? (
          <p className="text-sm text-[var(--psc-muted)]">
            FY{data.pendingBudget.fiscalYear} budget is still before the council
            {data.pendingBudget.councilYeas + data.pendingBudget.councilNays > 0
              ? ` (${data.pendingBudget.councilYeas}–${data.pendingBudget.councilNays})`
              : ""}
            .
          </p>
        ) : null}

        {data.awaitingMayorBudget ? (
          <div className="rounded border border-amber-400/50 bg-amber-50/60 p-3 text-sm dark:bg-amber-950/20">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium text-[var(--psc-ink)]">FY{data.awaitingMayorBudget.fiscalYear} city budget</p>
              <span className="rounded border border-amber-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-900">
                {ordinanceStatusLabel(data.awaitingMayorBudget.status)}
              </span>
            </div>
            <p className="mt-1 text-xs text-[var(--psc-muted)]">
              Passed council {data.awaitingMayorBudget.councilYeas}–{data.awaitingMayorBudget.councilNays}
              {data.awaitingMayorBudget.projectedDeficitMillions != null
                ? ` · projected balance ${formatFiscalMillions(data.awaitingMayorBudget.projectedDeficitMillions)}`
                : ""}
            </p>
            <BudgetEffectPreview
              departments={data.awaitingMayorBudget.lines.map((l) => ({
                departmentKey: l.departmentKey as import("@/lib/city-fiscal-data").CityFiscalDepartmentKey,
                amountMillions: l.amountMillions,
              }))}
              deficitMillions={data.awaitingMayorBudget.projectedDeficitMillions ?? 0}
            />
            <OrdinanceRollCallTable rows={data.awaitingMayorBudget.rollCall} />
            {canMayor ? (
              <div className="mt-3 space-y-2">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={pending}
                    className="rounded border border-green-700 bg-green-50 px-3 py-1.5 text-sm font-semibold text-green-800 disabled:opacity-50"
                    onClick={() =>
                      run(() => mayorSignBudget(data.awaitingMayorBudget!.id), data.awaitingMayorBudget!.id)
                    }
                  >
                    {pending && signatureNote?.targetId === data.awaitingMayorBudget.id
                      ? "Signing…"
                      : "Sign budget into law"}
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    className="rounded border border-red-800 bg-red-50 px-3 py-1.5 text-sm font-semibold text-red-800 disabled:opacity-50"
                    onClick={() =>
                      run(() => mayorVetoBudget(data.awaitingMayorBudget!.id), data.awaitingMayorBudget!.id)
                    }
                  >
                    Veto budget
                  </button>
                </div>
                {signatureNote?.targetId === data.awaitingMayorBudget.id ? (
                  <p
                    className={`text-xs font-medium ${
                      signatureNote.ok ? "text-green-900" : "text-red-900"
                    }`}
                  >
                    {signatureNote.message}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {data.awaitingMayorOrdinances.map((o) => (
          <div
            key={o.id}
            className="rounded border border-amber-400/50 bg-amber-50/60 p-3 text-sm dark:bg-amber-950/20"
          >
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium text-[var(--psc-ink)]">{o.title}</p>
              <span className="rounded border border-amber-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-900">
                {ordinanceStatusLabel(o.status)}
              </span>
            </div>
            <p className="mt-1 text-xs text-[var(--psc-muted)]">
              Passed council {o.councilYeas}–{o.councilNays} · sponsor {o.sponsorName ?? "Unknown"}
            </p>
            <OrdinanceEffectPreview
              category={o.category}
              issueKey={o.issueKey}
              stanceKey={o.stanceKey}
              stanceParams={o.stanceParams}
              compact
            />
            <OrdinanceRollCallTable rows={o.rollCall} />
            {canMayor ? (
              <div className="mt-3 space-y-2">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={pending}
                    className="rounded border border-green-700 bg-green-50 px-3 py-1.5 text-sm font-semibold text-green-800 disabled:opacity-50"
                    onClick={() => run(() => mayorSignOrdinance(o.id), o.id)}
                  >
                    {pending && signatureNote?.targetId === o.id ? "Signing…" : "Sign into law"}
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    className="rounded border border-red-800 bg-red-50 px-3 py-1.5 text-sm font-semibold text-red-800 disabled:opacity-50"
                    onClick={() => run(() => mayorVetoOrdinance(o.id), o.id)}
                  >
                    Veto
                  </button>
                </div>
                {signatureNote?.targetId === o.id ? (
                  <p
                    className={`text-xs font-medium ${
                      signatureNote.ok ? "text-green-900" : "text-red-900"
                    }`}
                  >
                    {signatureNote.message}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        ))}

        {!hasPendingSignatures && !data.pendingBudget ? (
          <p className="text-sm text-[var(--psc-muted)]">Nothing awaiting signature.</p>
        ) : null}
      </div>

      <div className="space-y-3 rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
        <h2 className="font-semibold">Department briefings</h2>
        <p className="text-xs text-[var(--psc-muted)]">
          Situation reports and responses from your department heads — use these for RP and city management.
        </p>
        {data.departmentReports.length > 0 ? (
          <ul className="space-y-3">
            {data.departmentReports.map((report) => (
              <li key={report.id}>
                <ReportCard report={report} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-[var(--psc-muted)]">No briefings yet.</p>
        )}
      </div>

      <div className="space-y-3 rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
        <h2 className="font-semibold">Issue directive</h2>
        <p className="text-xs text-[var(--psc-muted)]">
          Assign a task to a department head. They will acknowledge in the briefings feed; request updates as
          the work progresses.
        </p>

        {canMayor ? (
          <>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (!taskTitle.trim()) return;
                run(async () => {
                  const result = await assignDepartmentTask({
                    departmentKey: taskDept,
                    title: taskTitle.trim(),
                    instructions: taskInstructions.trim(),
                  });
                  if (result.ok) {
                    setTaskTitle("");
                    setTaskInstructions("");
                  }
                  return result;
                });
              }}
            >
              <label className="block space-y-1 text-xs">
                <span className="font-medium text-[var(--psc-ink)]">Department</span>
                <select
                  className="w-full rounded border border-[var(--psc-border)] bg-[var(--psc-bg)] px-2 py-1.5 text-sm"
                  value={taskDept}
                  onChange={(e) => setTaskDept(e.target.value)}
                >
                  {data.departments.map((d) => (
                    <option key={d.departmentKey} value={d.departmentKey}>
                      {d.departmentLabel}
                      {d.isVacant ? " (vacant)" : d.politicianName ? ` — ${d.politicianName}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              {taskDeptVacant ? (
                <p className="text-xs font-medium text-amber-900">
                  This department has no seated head — appoint a commissioner before issuing directives.
                </p>
              ) : null}
              <label className="block space-y-1 text-xs">
                <span className="font-medium text-[var(--psc-ink)]">Directive title</span>
                <input
                  type="text"
                  required
                  maxLength={120}
                  placeholder="e.g. Accelerate pothole repairs in Queens"
                  className="w-full rounded border border-[var(--psc-border)] bg-[var(--psc-bg)] px-2 py-1.5 text-sm"
                  value={taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                />
              </label>
              <label className="block space-y-1 text-xs">
                <span className="font-medium text-[var(--psc-ink)]">Instructions (optional)</span>
                <textarea
                  rows={3}
                  maxLength={800}
                  placeholder="Specific priorities, deadlines, or talking points for staff…"
                  className="w-full rounded border border-[var(--psc-border)] bg-[var(--psc-bg)] px-2 py-1.5 text-sm"
                  value={taskInstructions}
                  onChange={(e) => setTaskInstructions(e.target.value)}
                />
              </label>
              <button
                type="submit"
                disabled={pending || !taskTitle.trim() || taskDeptVacant}
                className="rounded bg-[var(--psc-accent)] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                Send directive
              </button>
            </form>

            {data.openDepartmentTasks.length > 0 ? (
              <div className="space-y-2 border-t border-[var(--psc-border)] pt-4">
                <h3 className="text-sm font-semibold text-[var(--psc-ink)]">Open directives</h3>
                <ul className="space-y-2">
                  {data.openDepartmentTasks.map((task) => (
                    <li
                      key={task.id}
                      className="rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] p-3 text-sm"
                    >
                      <p className="font-medium text-[var(--psc-ink)]">{task.title}</p>
                      <p className="text-xs text-[var(--psc-muted)]">
                        {task.departmentLabel}
                        {task.headName ? ` · ${task.headName}` : ""} · {formatReportTime(task.createdAt)}
                      </p>
                      {task.instructions ? (
                        <p className="mt-1 text-xs text-[var(--psc-muted)]">{task.instructions}</p>
                      ) : null}
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={pending}
                          className="rounded border border-[var(--psc-border)] px-2 py-1 text-xs font-semibold disabled:opacity-50"
                          onClick={() => run(() => requestDepartmentTaskUpdate(task.id))}
                        >
                          Request update
                        </button>
                        <button
                          type="button"
                          disabled={pending}
                          className="rounded border border-[var(--psc-border)] px-2 py-1 text-xs font-semibold text-[var(--psc-muted)] disabled:opacity-50"
                          onClick={() => run(() => closeDepartmentTask(task.id))}
                        >
                          Mark complete
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-[var(--psc-muted)]">Only the mayor may issue directives.</p>
        )}
      </div>

      {data.enactedBudgets.length > 0 ? (
        <div className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4 text-sm">
          <h2 className="font-semibold">Recent enacted budgets</h2>
          <ul className="mt-2 space-y-1 text-[var(--psc-muted)]">
            {data.enactedBudgets.slice(0, 3).map((b) => (
              <li key={b.id}>
                FY{b.fiscalYear} — passed council {b.councilYeas}–{b.councilNays}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {isAdmin ? (
        <button
          type="button"
          disabled={pending}
          className="text-xs text-[var(--psc-muted)] underline"
          onClick={() => run(() => syncCouncilCaucus())}
        >
          Admin: sync council caucus from ward seats
        </button>
      ) : null}
    </section>
  );
}
