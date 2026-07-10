"use client";

import { useMemo, useState } from "react";
import { ProfileImageWithFallback } from "@/components/profile-image-with-fallback";
import {
  appointDepartmentHead,
  removeDepartmentHead,
  type MayorActionResult,
} from "@/app/actions/mayor";
import type { AppointableDepartmentHead, DepartmentHeadRow } from "@/lib/city-office-data";

type Props = {
  canMayor: boolean;
  departments: DepartmentHeadRow[];
  appointableHeads: AppointableDepartmentHead[];
  pending: boolean;
  onRun: (fn: () => Promise<MayorActionResult>) => void;
};

export function MayorDepartmentHeadsPanel({
  canMayor,
  departments,
  appointableHeads,
  pending,
  onRun,
}: Props) {
  const [appointDept, setAppointDept] = useState(departments[0]?.departmentKey ?? "finance");
  const [appointCandidateId, setAppointCandidateId] = useState("");

  const candidatesForDept = useMemo(() => {
    return appointableHeads.filter(
      (c) => !c.currentDepartmentKey || c.currentDepartmentKey === appointDept,
    );
  }, [appointableHeads, appointDept]);

  const selectedDept = departments.find((d) => d.departmentKey === appointDept);

  return (
    <div className="space-y-3 rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
      <h2 className="font-semibold">Department heads</h2>
      <p className="text-xs text-[var(--psc-muted)]">
        Appoint or remove agency commissioners. Vacant departments pause directives until a head is seated.
      </p>

      <ul className="space-y-2">
        {departments.map((dept) => (
          <li
            key={dept.departmentKey}
            className={`flex flex-wrap items-center gap-3 rounded border px-3 py-2.5 text-sm ${
              dept.isVacant
                ? "border-amber-400/70 bg-amber-50/70 dark:bg-amber-950/20"
                : "border-[var(--psc-border)] bg-[var(--psc-canvas)]"
            }`}
          >
            <div className="h-10 w-10 shrink-0 overflow-hidden rounded bg-[var(--psc-panel)]">
              {dept.faceClaimUrl ? (
                <ProfileImageWithFallback
                  src={dept.faceClaimUrl}
                  name={dept.politicianName ?? dept.departmentLabel}
                  variant="portrait"
                  initialClassName="flex h-full w-full items-center justify-center text-xs font-semibold text-[var(--psc-muted)]"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-[10px] font-bold uppercase text-amber-800">
                  Vacant
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-medium text-[var(--psc-ink)]">{dept.departmentLabel}</p>
              <p className="text-xs text-[var(--psc-muted)]">
                {dept.isVacant ? (
                  <span className="font-semibold text-amber-900">Position vacant</span>
                ) : (
                  <>
                    {dept.politicianName}
                    {dept.politicianParty ? ` · ${dept.politicianParty}` : ""}
                  </>
                )}
              </p>
            </div>
            {canMayor && !dept.isVacant ? (
              <button
                type="button"
                disabled={pending}
                className="rounded border border-red-800 px-2 py-1 text-xs font-semibold text-red-800 disabled:opacity-50"
                onClick={() => onRun(() => removeDepartmentHead(dept.departmentKey))}
              >
                Remove
              </button>
            ) : null}
          </li>
        ))}
      </ul>

      {canMayor ? (
        <form
          className="space-y-3 border-t border-[var(--psc-border)] pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!appointCandidateId) return;
            onRun(() =>
              appointDepartmentHead({
                departmentKey: appointDept,
                simPoliticianId: appointCandidateId,
              }),
            );
          }}
        >
          <h3 className="text-sm font-semibold text-[var(--psc-ink)]">Appoint head</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1 text-xs">
              <span className="font-medium text-[var(--psc-ink)]">Department</span>
              <select
                className="w-full rounded border border-[var(--psc-border)] bg-[var(--psc-bg)] px-2 py-1.5 text-sm"
                value={appointDept}
                onChange={(e) => {
                  setAppointDept(e.target.value);
                  setAppointCandidateId("");
                }}
              >
                {departments.map((d) => (
                  <option key={d.departmentKey} value={d.departmentKey}>
                    {d.departmentLabel}
                    {d.isVacant ? " (vacant)" : ` — ${d.politicianName}`}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1 text-xs">
              <span className="font-medium text-[var(--psc-ink)]">Candidate</span>
              <select
                className="w-full rounded border border-[var(--psc-border)] bg-[var(--psc-bg)] px-2 py-1.5 text-sm"
                value={appointCandidateId}
                onChange={(e) => setAppointCandidateId(e.target.value)}
                required
              >
                <option value="">Select commissioner…</option>
                {candidatesForDept.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.currentDepartmentKey && c.currentDepartmentKey !== appointDept
                      ? " (seated elsewhere)"
                      : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {selectedDept?.isVacant ? (
            <p className="text-xs text-amber-900">This department is vacant — appointment will resume agency operations.</p>
          ) : null}
          <button
            type="submit"
            disabled={pending || !appointCandidateId}
            className="rounded bg-[var(--psc-accent)] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            Appoint
          </button>
        </form>
      ) : null}
    </div>
  );
}
