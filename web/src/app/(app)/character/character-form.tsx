"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { saveCharacter } from "@/app/actions/profile";
import { ProfileImageWithFallback } from "@/components/profile-image-with-fallback";
import { US_STATE_CODES } from "@/lib/character-onboarding";

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

export function CharacterForm({
  profile,
  variant = "default",
}: {
  profile: Profile | null;
  variant?: "default" | "onboarding";
}) {
  const router = useRouter();
  const [state, setState] = useState(profile?.residence_state ?? "CA");
  const [districts, setDistricts] = useState<DistrictRow[]>([]);
  const [districtsLoading, setDistrictsLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setDistrictsLoading(true);
      try {
        const res = await fetch(`/api/districts?state=${state}`);
        const body = (await res.json()) as { districts?: DistrictRow[] };
        if (!cancelled) setDistricts(body.districts ?? []);
      } finally {
        if (!cancelled) setDistrictsLoading(false);
      }
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
      setMessage("Saved.");
      if (variant === "onboarding") {
        router.push("/elections");
      } else {
        router.refresh();
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Unable to save.");
    } finally {
      setPending(false);
    }
  }

  const isOnboarding = variant === "onboarding";

  return (
    <form action={onSubmit} className="grid gap-6 border border-[var(--psc-border)] bg-[var(--psc-panel)] p-8">
      <div>
        <h2 className="text-lg font-semibold">
          {isOnboarding ? "Required information" : "Edit personnel record"}
        </h2>
        <p className="mt-2 text-sm text-[var(--psc-muted)]">
          {isOnboarding
            ? "All fields in this section are required. Optional narrative fields are below."
            : "Submit to save. Pick the state and congressional district that match your character's home — multiple players can share the same district for competitive House races."}
        </p>
      </div>

      <label className="grid gap-2 text-sm font-semibold">
        Name
        <input
          name="character_name"
          defaultValue={profile?.character_name ?? ""}
          required
          autoComplete="name"
          className="border border-[var(--psc-border)] bg-white px-3 py-2 font-normal"
        />
      </label>

      <label className="grid gap-2 text-sm font-semibold">
        Date of birth
        <input
          type="date"
          name="date_of_birth"
          defaultValue={profile?.date_of_birth ?? ""}
          required
          className="border border-[var(--psc-border)] bg-white px-3 py-2 font-normal"
        />
      </label>

      <label className="grid gap-2 text-sm font-semibold">
        Party
        <select
          name="party"
          defaultValue={profile?.party ?? "independent"}
          required
          className="border border-[var(--psc-border)] bg-white px-3 py-2 font-normal"
        >
          <option value="democrat">Democratic Party</option>
          <option value="republican">Republican Party</option>
          <option value="independent">Independent</option>
        </select>
      </label>

      <div className="grid gap-2 text-sm font-semibold">
        <span>Home state &amp; congressional district</span>
        <div className="grid gap-3 md:grid-cols-2">
          <select
            value={state}
            onChange={(e) => setState(e.target.value)}
            required
            aria-label="Home state"
            className="border border-[var(--psc-border)] bg-white px-3 py-2 font-normal"
          >
            {US_STATE_CODES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            name="home_district_code"
            defaultValue={profile?.home_district_code ?? ""}
            required
            disabled={districtsLoading}
            aria-label="Home congressional district"
            className="border border-[var(--psc-border)] bg-white px-3 py-2 font-normal disabled:opacity-60"
          >
            <option value="" disabled>
              {districtsLoading ? "Loading districts…" : isOnboarding ? "Select district…" : "Choose district (required)"}
            </option>
            {districts.map((d) => (
              <option key={d.code} value={d.code}>
                {d.code} — PVI {d.pvi} — {d.incumbent_party} — {d.incumbent_npc_name}
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs font-normal text-[var(--psc-muted)]">{leanHint}</p>
      </div>

      <div className="grid gap-2 text-sm font-semibold">
        <span>
          Portrait <span className="font-normal text-[var(--psc-muted)]">(optional)</span>
        </span>
        {profile?.face_claim_url ? (
          <div className="flex flex-wrap items-center gap-3 rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)]/50 p-3">
            <div className="h-20 w-20 shrink-0 overflow-hidden rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)]">
              <ProfileImageWithFallback
                src={profile.face_claim_url}
                name={profile?.character_name?.trim() || "Character"}
                className="h-full w-full object-cover"
                initialClassName="flex h-20 w-20 items-center justify-center text-lg font-semibold text-[var(--psc-muted)]"
              />
            </div>
            <p className="min-w-0 text-xs font-normal text-[var(--psc-muted)]">
              Current portrait. Choose a new file below to replace it, or save without choosing a
              file to keep this one.
            </p>
          </div>
        ) : null}
        <label className="grid gap-1.5 font-normal">
          <span className="text-xs font-normal text-[var(--psc-muted)]">
            Upload JPEG, PNG, WebP, or GIF (max 5MB). Images are stored on the game server.
          </span>
          <input
            type="file"
            name="portrait"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="border border-[var(--psc-border)] bg-white px-3 py-2 text-xs font-normal file:mr-3"
          />
        </label>
      </div>

      <label className="grid gap-2 text-sm font-semibold">
        Biography <span className="font-normal text-[var(--psc-muted)]">(optional)</span>
        <textarea
          name="bio"
          rows={4}
          defaultValue={profile?.bio ?? ""}
          className="border border-[var(--psc-border)] bg-white px-3 py-2 font-normal"
        />
      </label>

      <label className="grid gap-2 text-sm font-semibold">
        In-world biography <span className="font-normal text-[var(--psc-muted)]">(optional)</span>
        <textarea
          name="former_positions"
          rows={3}
          defaultValue={profile?.former_positions ?? ""}
          placeholder="Career narrative, public image, or backstory — can be added later."
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
        disabled={pending || districtsLoading}
        className="justify-self-start border border-[var(--psc-border)] bg-[var(--psc-ink)] px-6 py-3 text-sm font-semibold uppercase tracking-wide text-white disabled:opacity-60"
      >
        {pending ? "Saving…" : isOnboarding ? "Save and continue" : "Save record"}
      </button>
    </form>
  );
}
