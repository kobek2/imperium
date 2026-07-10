"use client";

import { useMemo, useState } from "react";
import { FormSubmitButton } from "@/components/form-submit-button";
import { councilDistrictLabel, NYC_CITY_NAME } from "@/lib/city";
import type { WardPopulation } from "@/lib/seat-populations";

type ElectionOffice = "mayor" | "council_ward";

const inputClass =
  "w-full min-w-0 border border-[var(--psc-border)] bg-white px-3 py-2 font-normal";
const labelClass = "grid min-w-0 gap-1 text-sm font-semibold";
const sectionTitle =
  "text-xs font-semibold uppercase tracking-[0.18em] text-[var(--psc-muted)]";

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_FILING_HOURS = 24;
const DEFAULT_PRIMARY_HOURS = 24;
const DEFAULT_GENERAL_HOURS = 48;

function toLocalInput(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

function nowRounded(step = 5) {
  const d = new Date();
  d.setSeconds(0, 0);
  const mins = d.getMinutes();
  const rounded = Math.ceil(mins / step) * step;
  d.setMinutes(rounded);
  return d;
}

function addHoursLocal(value: string, hours: number) {
  if (!value) return "";
  const base = new Date(value);
  if (Number.isNaN(base.getTime())) return "";
  return toLocalInput(new Date(base.getTime() + hours * HOUR_MS));
}

export function CreateElectionForm({
  action,
  wards,
  totalPlayers,
}: {
  action: (formData: FormData) => Promise<void>;
  wards: WardPopulation[];
  totalPlayers: number;
}) {
  const [office, setOffice] = useState<ElectionOffice>("council_ward");
  const [wardCode, setWardCode] = useState<string>(wards[0]?.code ?? "");

  const initial = useMemo(() => {
    const start = nowRounded(5);
    const filingOpens = toLocalInput(start);
    const filingCloses = addHoursLocal(filingOpens, DEFAULT_FILING_HOURS);
    const primaryCloses = addHoursLocal(filingCloses, DEFAULT_PRIMARY_HOURS);
    const generalCloses = addHoursLocal(primaryCloses, DEFAULT_GENERAL_HOURS);
    return { filingOpens, filingCloses, primaryCloses, generalCloses };
  }, []);

  const [filingOpensAt, setFilingOpensAt] = useState(initial.filingOpens);
  const [filingHours, setFilingHours] = useState<number>(DEFAULT_FILING_HOURS);
  const [primaryHours, setPrimaryHours] = useState<number>(DEFAULT_PRIMARY_HOURS);
  const [generalHours, setGeneralHours] = useState<number>(DEFAULT_GENERAL_HOURS);

  const filingClosesAt = addHoursLocal(filingOpensAt, filingHours);
  const primaryClosesAt = addHoursLocal(filingClosesAt, primaryHours);
  const generalClosesAt = addHoursLocal(primaryClosesAt, generalHours);

  const selectedWard = useMemo(
    () => wards.find((w) => w.code.toUpperCase() === wardCode.toUpperCase()) ?? null,
    [wards, wardCode],
  );

  const relevantPlayerCount =
    office === "mayor" ? totalPlayers : (selectedWard?.player_count ?? null);

  function handleReset() {
    const start = nowRounded(5);
    setFilingOpensAt(toLocalInput(start));
    setFilingHours(DEFAULT_FILING_HOURS);
    setPrimaryHours(DEFAULT_PRIMARY_HOURS);
    setGeneralHours(DEFAULT_GENERAL_HOURS);
  }

  return (
    <form
      action={action}
      className="grid min-w-0 gap-8 border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6"
    >
      <div className="space-y-3">
        <p className={sectionTitle}>Seat · {NYC_CITY_NAME}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={labelClass}>
            Office
            <select
              name="office"
              required
              value={office}
              onChange={(e) => setOffice(e.target.value as ElectionOffice)}
              className={inputClass}
            >
              <option value="mayor">Mayor of New York City</option>
              <option value="council_ward">City Council district</option>
            </select>
          </label>

          {office === "council_ward" ? (
            <label className={labelClass}>
              Council district
              <select
                name="ward_code"
                required
                value={wardCode}
                onChange={(e) => setWardCode(e.target.value)}
                className={`${inputClass} font-mono`}
              >
                {wards.map((w) => (
                  <option key={w.code} value={w.code}>
                    {councilDistrictLabel(w.code)} — {w.player_count}{" "}
                    {w.player_count === 1 ? "player" : "players"}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>

        {relevantPlayerCount != null ? (
          <p className="rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-3 py-2 text-xs text-[var(--psc-muted)]">
            {relevantPlayerCount === 0 ? (
              <strong className="text-amber-900">No players mapped to this seat yet.</strong>
            ) : (
              <>
                <strong className="text-[var(--psc-ink)]">{relevantPlayerCount}</strong>{" "}
                {relevantPlayerCount === 1 ? "player" : "players"} can file here based on character home ward.
              </>
            )}
          </p>
        ) : null}
      </div>

      <div className="space-y-3">
        <p className={sectionTitle}>Schedule (local time)</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={labelClass}>
            Filing opens
            <input
              type="datetime-local"
              name="filing_opens_at"
              required
              value={filingOpensAt}
              onChange={(e) => setFilingOpensAt(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className={labelClass}>
            Filing duration (hours)
            <input
              type="number"
              min={1}
              value={filingHours}
              onChange={(e) => setFilingHours(Number(e.target.value) || DEFAULT_FILING_HOURS)}
              className={inputClass}
            />
          </label>
          <label className={labelClass}>
            Primary duration (hours)
            <input
              type="number"
              min={1}
              value={primaryHours}
              onChange={(e) => setPrimaryHours(Number(e.target.value) || DEFAULT_PRIMARY_HOURS)}
              className={inputClass}
            />
          </label>
          <label className={labelClass}>
            General duration (hours)
            <input
              type="number"
              min={1}
              value={generalHours}
              onChange={(e) => setGeneralHours(Number(e.target.value) || DEFAULT_GENERAL_HOURS)}
              className={inputClass}
            />
          </label>
        </div>
        <input type="hidden" name="filing_closes_at" value={filingClosesAt} />
        <input type="hidden" name="primary_closes_at" value={primaryClosesAt} />
        <input type="hidden" name="general_closes_at" value={generalClosesAt} />
        <p className="text-xs text-[var(--psc-muted)]">
          Closes filing {filingClosesAt || "—"} · primary {primaryClosesAt || "—"} · general {generalClosesAt || "—"}
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="dormant_filing_window" value="on" />
          Dormant filing window (admin opens filings later)
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <FormSubmitButton
          idleLabel="Create election"
          pendingLabel="Creating…"
          className="rounded border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-4 py-2 text-sm font-semibold text-white"
        />
        <button type="button" onClick={handleReset} className="rounded border border-[var(--psc-border)] px-3 py-2 text-sm">
          Reset schedule
        </button>
      </div>
    </form>
  );
}
