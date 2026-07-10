"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useRef, Fragment } from "react";
import { saveCharacter } from "@/app/actions/profile";
import { ProfileImageWithFallback } from "@/components/profile-image-with-fallback";
import { NycCouncilDistrictsPanel } from "@/components/nyc-council-districts-panel";
import { SIM_REGIONS, normalizeSimRegionCode } from "@/lib/regions";
import { hasGeographicHomeChange } from "@/lib/geographic-move";

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
  district_number: number;
  name?: string;
  pvi: number;
  incumbent_party: string;
  incumbent_npc_name: string;
  claimed_by: string | null;
};

const PORTRAIT_MAX_BYTES = 5 * 1024 * 1024;
const PORTRAIT_ACCEPTED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export function CharacterForm({
  profile,
  variant = "default",
  onSaved,
  geographicMoveExempt = false,
}: {
  profile: Profile | null;
  variant?: "default" | "onboarding";
  onSaved?: () => void;
  geographicMoveExempt?: boolean;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const geoConfirmBypassRef = useRef(false);
  const [geoConfirmOpen, setGeoConfirmOpen] = useState(false);
  const initialRegion = normalizeSimRegionCode(profile?.residence_state);
  const [state, setState] = useState(initialRegion);
  const [homeDistrict, setHomeDistrict] = useState(() => {
    const d = (profile?.home_district_code ?? "").trim().toUpperCase();
    return /^W\d{2}$/.test(d) ? d : "";
  });
  const [districts, setDistricts] = useState<DistrictRow[]>([]);
  const [districtsLoading, setDistrictsLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [portraitPreview, setPortraitPreview] = useState<{
    name: string;
    sizeBytes: number;
    objectUrl: string;
  } | null>(null);
  const [portraitError, setPortraitError] = useState<string | null>(null);

  const isOnboarding = variant === "onboarding";

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setDistrictsLoading(true);
      try {
        const res = await fetch("/api/districts");
        const body = (await res.json()) as { districts?: DistrictRow[] };
        const rows = body.districts ?? [];
        if (!cancelled) {
          setDistricts(rows);
          setHomeDistrict((prev) => {
            if (prev && rows.some((r) => r.code.toUpperCase() === prev)) return prev;
            return rows[0]?.code?.toUpperCase() ?? "";
          });
        }
      } finally {
        if (!cancelled) setDistrictsLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (portraitPreview?.objectUrl) URL.revokeObjectURL(portraitPreview.objectUrl);
    };
  }, [portraitPreview?.objectUrl]);

  const formatBytes = useCallback((bytes: number) => {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${bytes} B`;
  }, []);

  const onPortraitChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0] ?? null;
      setPortraitPreview((prev) => {
        if (prev?.objectUrl) URL.revokeObjectURL(prev.objectUrl);
        return null;
      });
      setPortraitError(null);
      if (!file) return;
      if (!PORTRAIT_ACCEPTED_TYPES.has(file.type)) {
        setPortraitError(
          `That file type isn't supported${file.type ? ` (${file.type})` : ""}. Please choose a JPEG, PNG, WebP, or GIF.`,
        );
        return;
      }
      if (file.size > PORTRAIT_MAX_BYTES) {
        setPortraitError(
          `File is ${formatBytes(file.size)}. Please upload an image 5MB or smaller.`,
        );
        return;
      }
      setPortraitPreview({
        name: file.name,
        sizeBytes: file.size,
        objectUrl: URL.createObjectURL(file),
      });
    },
    [formatBytes],
  );

  /**
   * Submit via onSubmit + preventDefault (not <form action={...}>).
   * React 19 resets uncontrolled fields after a successful form `action` callback;
   * our defaults come from SSR `profile`, which is still stale until navigation/refresh,
   * so users saw the form wipe right after a successful save.
   */
  async function handleSubmit(formData: FormData) {
    setPending(true);
    setMessage(null);
    formData.set("residence_state", state);

    if (portraitError) {
      setMessage(portraitError);
      setPending(false);
      return;
    }

    const portrait = formData.get("portrait");
    if (portrait instanceof File && portrait.size > 0) {
      if (portrait.size > PORTRAIT_MAX_BYTES) {
        const mb = (portrait.size / (1024 * 1024)).toFixed(1);
        setMessage(`Portrait is ${mb}MB. Please upload an image 5MB or smaller.`);
        setPending(false);
        return;
      }
      if (!PORTRAIT_ACCEPTED_TYPES.has(portrait.type)) {
        setMessage("Portrait must be a JPEG, PNG, WebP, or GIF image.");
        setPending(false);
        return;
      }
    }

    const newResidence = state.trim().toUpperCase();
    const newDistrict = String(formData.get("home_district_code") ?? "").trim().toUpperCase();
    const geographyChanges =
      !isOnboarding &&
      hasGeographicHomeChange({
        prevResidenceState: profile?.residence_state,
        prevHomeDistrict: profile?.home_district_code,
        nextResidenceState: newResidence,
        nextHomeDistrict: newDistrict,
      });

    if (geographyChanges && !geographicMoveExempt && !geoConfirmBypassRef.current) {
      setPending(false);
      setGeoConfirmOpen(true);
      return;
    }

    try {
      await saveCharacter(formData);
      geoConfirmBypassRef.current = false;
      const uploaded =
        portrait instanceof File && portrait.size > 0
          ? "Saved. Portrait uploaded."
          : "Saved.";
      setMessage(uploaded);
      setPending(false);
      if (variant === "onboarding") {
        router.push("/elections");
        return;
      }
      if (onSaved) {
        // Give the user a beat to see the confirmation before the form collapses.
        setTimeout(() => onSaved(), 700);
        return;
      }
      router.refresh();
    } catch (err) {
      geoConfirmBypassRef.current = false;
      const raw = err instanceof Error ? err.message : "";
      const lower = raw.toLowerCase();
      const looksLikeNetwork =
        lower.includes("failed to fetch") ||
        lower.includes("networkerror") ||
        lower.includes("load failed") ||
        lower.includes("network request failed");
      setMessage(
        looksLikeNetwork
          ? "Could not reach the server (network error). Check your connection, wait a moment, and try again. If it keeps happening, refresh the page."
          : raw || "Unable to save.",
      );
      setPending(false);
    }
  }

  return (
    <Fragment>
      <form
        ref={formRef}
        className="grid gap-6 border border-[var(--psc-border)] bg-[var(--psc-panel)] p-8"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSubmit(new FormData(e.currentTarget));
        }}
      >
      <div>
        <h2 className="text-lg font-semibold">
          {isOnboarding ? "Required information" : "Edit personnel record"}
        </h2>
        <p className="mt-2 text-sm text-[var(--psc-muted)]">
          {isOnboarding
            ? "All fields in this section are required. Optional narrative fields are below."
            : "Submit to save. Pick your NYC council district — it must match any ward race you file for."}
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
        <span>Home city &amp; council district</span>
        <NycCouncilDistrictsPanel
          title={isOnboarding ? "Pick your council district" : "NYC council districts"}
          compact
          selectedCode={homeDistrict || null}
          onSelect={setHomeDistrict}
        />
        <div className="grid gap-3 md:grid-cols-2">
          <select
            name="residence_state"
            value={state}
            onChange={(e) => {
              setState(normalizeSimRegionCode(e.target.value));
              setHomeDistrict("");
            }}
            required
            aria-label="Home region"
            className="border border-[var(--psc-border)] bg-white px-3 py-2 font-normal"
          >
            {SIM_REGIONS.map((r) => (
              <option key={r.code} value={r.code}>
                {r.code} — {r.name}
              </option>
            ))}
          </select>
          <select
            name="home_district_code"
            value={homeDistrict}
            onChange={(e) => setHomeDistrict(e.target.value)}
            required
            disabled={districtsLoading || districts.length === 0}
            aria-label="Home council district"
            className="border border-[var(--psc-border)] bg-white px-3 py-2 font-normal disabled:opacity-60"
          >
            <option value="" disabled>
              {districtsLoading ? "Loading districts…" : isOnboarding ? "Select district…" : "Choose district (required)"}
            </option>
            {districts.map((d) => (
              <option key={d.code} value={d.code}>
                {d.name
                  ? `${d.name} (${d.code})`
                  : `District ${d.district_number} (${d.code})`}
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs font-normal text-[var(--psc-muted)]">
          Seven NYC council districts (W01–W07). Your home district must match any council ward race you file for.
        </p>
      </div>

      <div className="grid gap-2 text-sm font-semibold">
        <span>
          Portrait <span className="font-normal text-[var(--psc-muted)]">(optional)</span>
        </span>
        {profile?.face_claim_url && !portraitPreview ? (
          <div className="flex flex-wrap items-center gap-3 rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)]/50 p-3">
            <div className="h-20 w-20 shrink-0 overflow-hidden rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)]">
              <ProfileImageWithFallback
                src={profile.face_claim_url}
                name={profile?.character_name?.trim() || "Character"}
                variant="portrait"
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
            onChange={onPortraitChange}
            className="border border-[var(--psc-border)] bg-white px-3 py-2 text-xs font-normal file:mr-3"
          />
        </label>
        {portraitPreview ? (
          <div className="flex flex-wrap items-center gap-3 rounded border border-emerald-500/60 bg-emerald-50 p-3">
            <div className="h-20 w-20 shrink-0 overflow-hidden rounded border border-emerald-500/40 bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={portraitPreview.objectUrl}
                alt="Portrait preview"
                className="h-full w-full object-cover object-top"
              />
            </div>
            <div className="min-w-0 text-xs font-normal text-emerald-900">
              <p className="font-semibold">Ready to upload</p>
              <p className="break-all">
                {portraitPreview.name} · {formatBytes(portraitPreview.sizeBytes)}
              </p>
              <p className="mt-1 text-[var(--psc-muted)]">
                Click {isOnboarding ? "Save and continue" : "Save record"} to apply this portrait.
              </p>
            </div>
          </div>
        ) : null}
        {portraitError ? (
          <p
            className="rounded border border-red-500/50 bg-red-50 px-3 py-2 text-xs font-normal text-red-800"
            aria-live="polite"
          >
            {portraitError}
          </p>
        ) : null}
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
        disabled={pending || districtsLoading || Boolean(portraitError)}
        className="justify-self-start border border-[var(--psc-border)] bg-[var(--psc-ink)] px-6 py-3 text-sm font-semibold uppercase tracking-wide text-white disabled:opacity-60"
      >
        {pending ? "Saving…" : isOnboarding ? "Save and continue" : "Save record"}
      </button>
    </form>

      {geoConfirmOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="geo-move-title"
        >
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6 shadow-lg">
            <h3 id="geo-move-title" className="text-base font-semibold text-[var(--psc-ink)]">
              Change home region or council district?
            </h3>
            <div className="mt-3 space-y-2 text-sm text-[var(--psc-ink)]">
              <p>
                Relocating updates where you can file for mayor and council ward races. This action
                has consequences for most characters:
              </p>
              <ul className="list-disc space-y-1.5 pl-5 text-[var(--psc-muted)]">
                <li>Your public approval rating drops by 10.</li>
                <li>
                  If you serve on the City Council, you leave your seat and any council leadership
                  office you hold.
                </li>
              </ul>
              <p className="text-[var(--psc-muted)]">
                Sitting mayors and appointed department heads are not affected by these rules.
              </p>
            </div>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-4 py-2 text-sm font-semibold text-[var(--psc-ink)]"
                onClick={() => {
                  setGeoConfirmOpen(false);
                  geoConfirmBypassRef.current = false;
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="border border-amber-900/40 bg-amber-950 px-4 py-2 text-sm font-semibold text-amber-50"
                onClick={() => {
                  geoConfirmBypassRef.current = true;
                  setGeoConfirmOpen(false);
                  setPending(true);
                  if (formRef.current) {
                    void handleSubmit(new FormData(formRef.current));
                  }
                }}
              >
                I understand — save new home
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </Fragment>
  );
}
