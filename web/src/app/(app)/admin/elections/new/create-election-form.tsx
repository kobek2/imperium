"use client";

import { useMemo, useState } from "react";
import { FormSubmitButton } from "@/components/form-submit-button";

type ElectionOffice = "house" | "senate" | "president";

export type DistrictOption = {
  code: string;
  state: string;
  player_count: number;
  incumbent_party: string | null;
  incumbent_npc_name: string | null;
};

export type StateOption = {
  code: string;
  name: string;
  player_count: number;
  pvi: number;
};

const inputClass =
  "w-full min-w-0 border border-[var(--psc-border)] bg-white px-3 py-2 font-normal";
const labelClass = "grid min-w-0 gap-1 text-sm font-semibold";
const sectionTitle =
  "text-xs font-semibold uppercase tracking-[0.18em] text-[var(--psc-muted)]";

const HOUR_MS = 60 * 60 * 1000;

// Defaults requested: filing 24h, primary 24h, general 48h.
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
  districts,
  states,
  totalPlayers,
}: {
  action: (formData: FormData) => Promise<void>;
  districts: DistrictOption[];
  states: StateOption[];
  totalPlayers: number;
}) {
  const [office, setOffice] = useState<ElectionOffice>("house");
  const [stateCode, setStateCode] = useState<string>("");
  const [districtCode, setDistrictCode] = useState<string>("");

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

  const needsState = office === "house" || office === "senate";
  const needsDistrict = office === "house";
  const needsSenateClass = office === "senate";

  // Filter districts to the picked state so the dropdown isn't 435 rows long.
  const districtsForState = useMemo(() => {
    if (!stateCode) return [] as DistrictOption[];
    return districts.filter((d) => d.state.toUpperCase() === stateCode.toUpperCase());
  }, [districts, stateCode]);

  const selectedState = useMemo(
    () => states.find((s) => s.code.toUpperCase() === stateCode.toUpperCase()) ?? null,
    [states, stateCode],
  );
  const selectedDistrict = useMemo(
    () => districts.find((d) => d.code.toUpperCase() === districtCode.toUpperCase()) ?? null,
    [districts, districtCode],
  );

  // Which population matters for the current office selection. Used by the banner below
  // so admins know at a glance whether anyone can actually file for this seat.
  const relevantPlayerCount: number | null =
    office === "house"
      ? selectedDistrict?.player_count ?? null
      : office === "senate"
        ? selectedState?.player_count ?? null
        : office === "president"
          ? totalPlayers
          : null;

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
        <p className={sectionTitle}>Seat</p>
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
              <option value="house">House</option>
              <option value="senate">Senate</option>
              <option value="president">President</option>
            </select>
            <span className="text-xs font-normal text-[var(--psc-muted)]">
              For Speaker / Leader / Whip / PPT, use the{" "}
              <strong>Leadership elections</strong> toggle on the elections dashboard instead.
            </span>
          </label>

          {needsState ? (
            <label className={labelClass}>
              State
              <select
                name="state"
                required
                value={stateCode}
                onChange={(e) => {
                  setStateCode(e.target.value);
                  setDistrictCode("");
                }}
                className={`${inputClass} font-mono`}
              >
                <option value="">Choose a state…</option>
                {states.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.code} · {s.name} — {s.player_count}{" "}
                    {s.player_count === 1 ? "player" : "players"}
                    {s.player_count === 0 ? " (empty)" : ""}
                  </option>
                ))}
              </select>
              <span className="text-xs font-normal text-[var(--psc-muted)]">
                Counts come from <code className="font-mono">profiles.residence_state</code>.
                Empty states are still selectable — you'll get a warning below.
              </span>
            </label>
          ) : null}

          {needsDistrict ? (
            <label className={labelClass}>
              District
              <select
                name="district_code"
                required
                value={districtCode}
                onChange={(e) => setDistrictCode(e.target.value)}
                disabled={!stateCode}
                className={`${inputClass} font-mono`}
              >
                <option value="">
                  {stateCode ? "Choose a district…" : "Pick a state first"}
                </option>
                {districtsForState.map((d) => (
                  <option key={d.code} value={d.code}>
                    {d.code} — {d.player_count}{" "}
                    {d.player_count === 1 ? "player" : "players"}
                    {d.player_count === 0 ? " (empty)" : ""}
                    {d.incumbent_npc_name ? ` · held by ${d.incumbent_npc_name}` : ""}
                  </option>
                ))}
              </select>
              <span className="text-xs font-normal text-[var(--psc-muted)]">
                Counts come from <code className="font-mono">profiles.home_district_code</code>.
              </span>
            </label>
          ) : null}

          {needsSenateClass ? (
            <label className={labelClass}>
              Senate class
              <select name="senate_class" required className={inputClass}>
                <option value="">Choose class…</option>
                <option value="1">Class I</option>
                <option value="2">Class II</option>
                <option value="3">Class III</option>
              </select>
            </label>
          ) : null}

          {office === "president" ? (
            <p className="self-end text-xs text-[var(--psc-muted)] leading-relaxed">
              Presidential races are nationwide. No state or district is stored on the election row.
            </p>
          ) : null}
        </div>

        <SeatPopulationBanner
          office={office}
          relevantPlayerCount={relevantPlayerCount}
          stateLabel={selectedState ? `${selectedState.code} ${selectedState.name}` : null}
          districtLabel={selectedDistrict ? selectedDistrict.code : null}
        />
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className={sectionTitle}>Schedule</p>
          <button
            type="button"
            onClick={handleReset}
            className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-accent)] underline"
          >
            Reset to defaults
          </button>
        </div>
        <p className="text-xs text-[var(--psc-muted)] leading-relaxed">
          Defaults: filing 24h, primary 24h, general 48h. Edit the filing start and the durations
          below — the other deadlines update automatically. Times are stored in UTC.
        </p>

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
            Filing length (hours)
            <input
              type="number"
              min={1}
              step={1}
              value={filingHours}
              onChange={(e) => setFilingHours(Math.max(1, Number(e.target.value) || 0))}
              className={inputClass}
            />
          </label>
          <label className={labelClass}>
            Primary length (hours)
            <input
              type="number"
              min={1}
              step={1}
              value={primaryHours}
              onChange={(e) => setPrimaryHours(Math.max(1, Number(e.target.value) || 0))}
              className={inputClass}
            />
          </label>
          <label className={labelClass}>
            General length (hours)
            <input
              type="number"
              min={1}
              step={1}
              value={generalHours}
              onChange={(e) => setGeneralHours(Math.max(1, Number(e.target.value) || 0))}
              className={inputClass}
            />
          </label>
        </div>

        <input type="hidden" name="filing_closes_at" value={filingClosesAt} />
        <input type="hidden" name="primary_closes_at" value={primaryClosesAt} />
        <input type="hidden" name="general_closes_at" value={generalClosesAt} />

        <dl className="grid gap-1 rounded border border-dashed border-[var(--psc-border)] bg-[var(--psc-canvas)]/60 p-3 text-xs text-[var(--psc-muted)] sm:grid-cols-3">
          <div>
            <dt className="font-semibold text-[var(--psc-ink)]">Filing closes</dt>
            <dd className="font-mono">{filingClosesAt || "—"}</dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--psc-ink)]">Primary closes</dt>
            <dd className="font-mono">{primaryClosesAt || "—"}</dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--psc-ink)]">General closes</dt>
            <dd className="font-mono">{generalClosesAt || "—"}</dd>
          </div>
        </dl>
      </div>

      <div className="space-y-3">
        <p className={sectionTitle}>Primary ballot</p>
        {office === "president" ? (
          <>
            <input type="hidden" name="primary_ballot_scope" value="party_wide" />
            <p className="text-xs text-[var(--psc-muted)] leading-relaxed">
              Presidential primaries are always party-wide.
            </p>
          </>
        ) : (
          <label className={labelClass}>
            Who may vote in the primary
            <select name="primary_ballot_scope" defaultValue="party_wide" className={inputClass}>
              <option value="party_wide">Party-wide (any same-party voter)</option>
              <option value="jurisdiction_only">Jurisdiction only (seat residents + self)</option>
            </select>
            <span className="text-xs font-normal text-[var(--psc-muted)]">
              Party-wide lets any same-party member vote. Jurisdiction-only limits voting to players whose
              Character matches this seat, plus candidates voting for themselves.
            </span>
          </label>
        )}
      </div>

      <FormSubmitButton
        idleLabel="Create election"
        pendingLabel="Creating..."
        className="mt-1 border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-4 py-2 text-sm font-semibold uppercase tracking-wide text-white"
      />
    </form>
  );
}

function SeatPopulationBanner({
  office,
  relevantPlayerCount,
  stateLabel,
  districtLabel,
}: {
  office: ElectionOffice;
  relevantPlayerCount: number | null;
  stateLabel: string | null;
  districtLabel: string | null;
}) {
  if (relevantPlayerCount === null) {
    return null;
  }

  const seatLabel =
    office === "house"
      ? districtLabel ?? "this district"
      : office === "senate"
        ? stateLabel ?? "this state"
        : "the whole country";

  if (relevantPlayerCount === 0) {
    return (
      <div className="rounded border border-amber-400 bg-amber-50 p-3 text-xs text-amber-950">
        <p className="font-semibold uppercase tracking-wide">No players here</p>
        <p className="mt-1">
          No players have {seatLabel} set on their Character page yet
          {office === "house" || office === "senate"
            ? ". If you spin up this race, only the incumbent NPC will be on the ballot unless " +
              "someone updates their residence. Consider holding off, or create a party-wide " +
              "primary so anyone can still file."
            : "."}
        </p>
      </div>
    );
  }

  if (relevantPlayerCount < 2 && office !== "president") {
    return (
      <div className="rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
        <p className="font-semibold uppercase tracking-wide">
          Only {relevantPlayerCount} player in {seatLabel}
        </p>
        <p className="mt-1">
          Without a second resident, the primary will be uncontested. You can still proceed —
          the scheduler won&apos;t break — but nothing real will happen in the filing window.
        </p>
      </div>
    );
  }

  const tone =
    relevantPlayerCount >= 4
      ? "border-emerald-300 bg-emerald-50 text-emerald-900"
      : "border-sky-300 bg-sky-50 text-sky-900";
  return (
    <div className={`rounded border p-3 text-xs ${tone}`}>
      <p className="font-semibold uppercase tracking-wide">
        {relevantPlayerCount} {relevantPlayerCount === 1 ? "player" : "players"} in {seatLabel}
      </p>
      <p className="mt-1">
        {office === "president"
          ? "Every player can file for president. Presidential races ignore residence for filing."
          : "These are the players whose Character record currently matches this seat."}
      </p>
    </div>
  );
}
