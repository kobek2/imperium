"use client";

import { useEffect, useRef, useState } from "react";
import { CharacterForm } from "./character-form";
import { PersonnelRecord, type PersonnelProfile } from "./personnel-record";

export function PersonnelEditShell({
  profile,
  userId,
  primaryTitle,
  setupMode = false,
}: {
  profile: PersonnelProfile;
  userId: string;
  primaryTitle: string;
  setupMode?: boolean;
}) {
  const [editing, setEditing] = useState(setupMode);

  // When a first-time user finishes setup (setupMode flips true → false after router.refresh()),
  // collapse the edit form automatically so they see their saved personnel record instead of the
  // still-open form. Users who open the editor later aren't affected because setupMode stays false.
  const wasSetup = useRef(setupMode);
  useEffect(() => {
    if (wasSetup.current && !setupMode) {
      setEditing(false);
    }
    wasSetup.current = setupMode;
  }, [setupMode]);

  return (
    <div className="space-y-8">
      {setupMode ? (
        <section className="border-2 border-[var(--psc-accent)] bg-[var(--psc-accent)]/5 p-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--psc-accent)]">
            Welcome to PolSim
          </p>
          <h2 className="mt-1 text-xl font-semibold text-[var(--psc-ink)]">
            Create your character
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-[var(--psc-muted)]">
            Pick a name, party, home state, and district so you can file for office,
            vote, and appear in the federal directory. You can edit these later.
          </p>
        </section>
      ) : null}
      <div className="relative">
        {!setupMode ? (
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="absolute right-0 top-0 z-10 border border-[var(--psc-border)] bg-[var(--psc-panel)] px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--psc-ink)] shadow-sm transition hover:bg-[var(--psc-canvas)] active:scale-[0.98]"
          >
            {editing ? "Close" : "Edit"}
          </button>
        ) : null}
        <PersonnelRecord primaryTitle={primaryTitle} profile={profile} />
      </div>
      {editing ? <CharacterForm profile={profile} userId={userId} /> : null}
    </div>
  );
}
