"use client";

import { useState } from "react";
import { CharacterForm } from "./character-form";
import { PersonnelRecord, type PersonnelProfile } from "./personnel-record";

export function PersonnelEditShell({
  profile,
  userId,
  primaryTitle,
}: {
  profile: PersonnelProfile;
  userId: string;
  primaryTitle: string;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div className="space-y-8">
      <div className="relative">
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          className="absolute right-0 top-0 z-10 border border-[var(--psc-border)] bg-[var(--psc-panel)] px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--psc-ink)] shadow-sm transition hover:bg-[var(--psc-canvas)] active:scale-[0.98]"
        >
          {editing ? "Close" : "Edit"}
        </button>
        <PersonnelRecord primaryTitle={primaryTitle} profile={profile} />
      </div>
      {editing ? <CharacterForm profile={profile} userId={userId} /> : null}
    </div>
  );
}
