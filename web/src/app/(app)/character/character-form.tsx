"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { saveCharacter } from "@/app/actions/profile";

type Profile = {
  character_name: string | null;
  date_of_birth: string | null;
  residence_state: string | null;
  home_district_code: string | null;
  party: string | null;
  bio: string | null;
  face_claim_url: string | null;
  former_positions: string | null;
  discord_username?: string | null;
};

type DistrictRow = {
  code: string;
  pvi: number;
  incumbent_party: string;
  incumbent_npc_name: string;
  claimed_by: string | null;
};

const STATE_CODES = [
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
] as const;

export function CharacterForm({
  profile,
  userId,
}: {
  profile: Profile | null;
  userId: string;
}) {
  const router = useRouter();
  const [state, setState] = useState(profile?.residence_state ?? "CA");
  const [districts, setDistricts] = useState<DistrictRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await fetch(`/api/districts?state=${state}`);
      const body = (await res.json()) as { districts?: DistrictRow[] };
      if (!cancelled) setDistricts(body.districts ?? []);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [state]);

  const leanHint = useMemo(() => {
    return "Positive PVI favors Democrats; negative favors Republicans (Cook-style).";
  }, []);

  async function onSubmit(formData: FormData) {
    setPending(true);
    setMessage(null);
    formData.set("residence_state", state);
    try {
      await saveCharacter(formData);
      setMessage("Saved. District claim updated if applicable.");
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Unable to save.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form action={onSubmit} className="grid gap-6 border border-[var(--psc-border)] bg-[var(--psc-panel)] p-8">
      <div>
        <h2 className="text-lg font-semibold">Edit personnel record</h2>
        <p className="mt-2 text-sm text-[var(--psc-muted)]">
          Submit to save. District list follows the state selector; choose a district to claim that seat
          when open.
        </p>
      </div>

      <label className="grid gap-2 text-sm font-semibold">
        Legal name (RP)
        <input
          name="character_name"
          defaultValue={profile?.character_name ?? ""}
          required
          className="border border-[var(--psc-border)] bg-white px-3 py-2 font-normal"
        />
      </label>

      <label className="grid gap-2 text-sm font-semibold">
        Date of birth
        <input
          type="date"
          name="date_of_birth"
          defaultValue={profile?.date_of_birth ?? ""}
          className="border border-[var(--psc-border)] bg-white px-3 py-2 font-normal"
        />
      </label>

      <label className="grid gap-2 text-sm font-semibold">
        Party
        <select
          name="party"
          defaultValue={profile?.party ?? "independent"}
          className="border border-[var(--psc-border)] bg-white px-3 py-2 font-normal"
        >
          <option value="democrat">Democratic Party</option>
          <option value="republican">Republican Party</option>
          <option value="independent">Independent</option>
        </select>
      </label>

      <div className="grid gap-2 text-sm font-semibold">
        <span>Home district (real seat)</span>
        <div className="grid gap-3 md:grid-cols-2">
          <select
            value={state}
            onChange={(e) => setState(e.target.value)}
            className="border border-[var(--psc-border)] bg-white px-3 py-2 font-normal"
          >
            {STATE_CODES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            name="home_district_code"
            defaultValue={profile?.home_district_code ?? ""}
            className="border border-[var(--psc-border)] bg-white px-3 py-2 font-normal"
          >
            <option value="">No district selected</option>
            {districts.map((d) => {
              const locked = Boolean(d.claimed_by && d.claimed_by !== userId);
              return (
                <option key={d.code} value={d.code} disabled={locked}>
                  {d.code} — PVI {d.pvi} — {d.incumbent_party} —{" "}
                  {locked ? "CLAIMED" : d.incumbent_npc_name}
                </option>
              );
            })}
          </select>
        </div>
        <p className="text-xs font-normal text-[var(--psc-muted)]">{leanHint}</p>
      </div>

      <label className="grid gap-2 text-sm font-semibold">
        Face claim / portrait URL
        <input
          name="face_claim_url"
          defaultValue={profile?.face_claim_url ?? ""}
          className="border border-[var(--psc-border)] bg-white px-3 py-2 font-normal"
        />
      </label>

      <label className="grid gap-2 text-sm font-semibold">
        Biography
        <textarea
          name="bio"
          rows={4}
          defaultValue={profile?.bio ?? ""}
          className="border border-[var(--psc-border)] bg-white px-3 py-2 font-normal"
        />
      </label>

      <label className="grid gap-2 text-sm font-semibold">
        Former positions (RP history)
        <textarea
          name="former_positions"
          rows={3}
          defaultValue={profile?.former_positions ?? ""}
          className="border border-[var(--psc-border)] bg-white px-3 py-2 font-normal"
        />
      </label>

      {message ? (
        <p className="text-sm text-[var(--psc-ink)]" aria-live="polite">
          {message}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="justify-self-start border border-[var(--psc-border)] bg-[var(--psc-ink)] px-6 py-3 text-sm font-semibold uppercase tracking-wide text-white disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save record"}
      </button>
    </form>
  );
}
