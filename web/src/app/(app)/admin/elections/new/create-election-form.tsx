"use client";

import { useState } from "react";
import { FormSubmitButton } from "@/components/form-submit-button";

type ElectionOffice = "house" | "senate" | "president";

const inputClass =
  "border border-[var(--psc-border)] bg-white px-3 py-2 font-normal";
const labelClass = "grid gap-1 text-sm font-semibold";
const sectionTitle = "text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]";

export function CreateElectionForm({ action }: { action: (formData: FormData) => Promise<void> }) {
  const [office, setOffice] = useState<ElectionOffice>("house");

  const needsState = office === "house" || office === "senate";
  const needsDistrict = office === "house";
  const needsSenateClass = office === "senate";

  return (
    <form action={action} className="grid gap-6 border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
      <div className="space-y-3">
        <p className={sectionTitle}>Seat</p>
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
        </label>

        {office === "president" ? (
          <p className="text-xs text-[var(--psc-muted)] leading-relaxed">
            Presidential races are nationwide. No state or district is stored on the election row.
          </p>
        ) : null}

        {needsState ? (
          <label className={labelClass}>
            State
            <input
              name="state"
              maxLength={2}
              placeholder="CA"
              required
              autoComplete="off"
              className={`${inputClass} font-mono uppercase`}
            />
            <span className="text-xs font-normal text-[var(--psc-muted)]">Two-letter USPS code.</span>
          </label>
        ) : null}

        {needsDistrict ? (
          <label className={labelClass}>
            District code
            <input
              name="district_code"
              placeholder="CA-01"
              required
              autoComplete="off"
              className={`${inputClass} font-mono`}
            />
            <span className="text-xs font-normal text-[var(--psc-muted)]">
              Must match a row in <code className="font-mono">districts</code> (e.g. CA-01).
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
      </div>

      <div className="space-y-3">
        <p className={sectionTitle}>Schedule</p>
        <p className="text-xs text-[var(--psc-muted)] leading-relaxed">
          Times are interpreted in the browser&apos;s local timezone and stored as UTC.
        </p>
        <label className={labelClass}>
          Filing opens
          <input type="datetime-local" name="filing_opens_at" required className={inputClass} />
        </label>
        <label className={labelClass}>
          Filing closes
          <input type="datetime-local" name="filing_closes_at" required className={inputClass} />
        </label>
        <label className={labelClass}>
          Primary closes
          <input type="datetime-local" name="primary_closes_at" required className={inputClass} />
        </label>
        <label className={labelClass}>
          General closes
          <input type="datetime-local" name="general_closes_at" required className={inputClass} />
        </label>
      </div>

      <div className="space-y-3">
        <p className={sectionTitle}>Primary ballot</p>
        {office === "president" ? (
          <>
            <input type="hidden" name="primary_ballot_scope" value="party_wide" />
            <p className="text-xs text-[var(--psc-muted)] leading-relaxed">
              Presidential primaries are always party-wide (same rule as the server).
            </p>
          </>
        ) : (
          <>
            <label className={labelClass}>
              Who may vote in the primary
              <select name="primary_ballot_scope" defaultValue="party_wide" className={inputClass}>
                <option value="party_wide">
                  Party-wide — same party may vote from any district/state (e.g. pick nominees elsewhere)
                </option>
                <option value="jurisdiction_only">
                  Jurisdiction only — House/Senate seat residents on their Character record (candidates may
                  still vote for themselves)
                </option>
              </select>
            </label>
          </>
        )}
      </div>

      <FormSubmitButton
        idleLabel="Create"
        pendingLabel="Creating..."
        className="mt-1 border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-4 py-2 text-sm font-semibold uppercase tracking-wide text-white"
      />
    </form>
  );
}
