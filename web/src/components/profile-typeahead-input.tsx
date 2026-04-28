"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type ProfileHit = {
  id: string;
  character_name: string | null;
  discord_username: string | null;
};

function escapeIlike(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function labelForProfile(p: ProfileHit) {
  const name = p.character_name?.trim() || "Unknown";
  const handle = p.discord_username?.trim();
  return handle ? `${name} (@${handle})` : name;
}

export function ProfileTypeaheadInput({
  hiddenName,
  required = false,
  placeholder = "Start typing a character name…",
  initialUserId = "",
  initialLabel = "",
}: {
  hiddenName: string;
  required?: boolean;
  placeholder?: string;
  initialUserId?: string;
  initialLabel?: string;
}) {
  const [query, setQuery] = useState(initialLabel);
  const [selectedUserId, setSelectedUserId] = useState(initialUserId);
  const [results, setResults] = useState<ProfileHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const canShow = open && results.length > 0;

  const runSearch = async (needleRaw: string) => {
    const needle = needleRaw.trim();
    if (!needle) {
      setResults([]);
      setLoading(false);
      return;
    }
    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch {
      setLoading(false);
      return;
    }
    const esc = escapeIlike(needle);
    const pattern = `%${esc}%`;
    const { data, error } = await supabase
      .from("profiles")
      .select("id, character_name, discord_username")
      .or(`character_name.ilike.${pattern},discord_username.ilike.${pattern}`)
      .order("character_name", { ascending: true })
      .limit(8);
    if (!error) {
      setResults((data ?? []) as ProfileHit[]);
      setHighlight(0);
    }
    setLoading(false);
  };

  const scheduleSearch = (value: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setLoading(true);
    timerRef.current = setTimeout(() => {
      void runSearch(value);
    }, 150);
  };

  const resultLabels = useMemo(() => results.map((r) => labelForProfile(r)), [results]);

  const pick = (p: ProfileHit) => {
    setQuery(labelForProfile(p));
    setSelectedUserId(p.id);
    setOpen(false);
    setResults([]);
  };

  return (
    <div ref={rootRef} className="relative">
      <input type="hidden" name={hiddenName} value={selectedUserId} required={required} />
      <input
        value={query}
        onFocus={() => {
          setOpen(true);
          if (query.trim().length > 0) scheduleSearch(query);
        }}
        onChange={(e) => {
          const next = e.target.value;
          setQuery(next);
          setSelectedUserId("");
          setOpen(true);
          scheduleSearch(next);
        }}
        onKeyDown={(e) => {
          if (!canShow) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlight((h) => (h + 1) % results.length);
            return;
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => (h - 1 + results.length) % results.length);
            return;
          }
          if (e.key === "Enter") {
            e.preventDefault();
            const pickRow = results[highlight];
            if (pickRow) pick(pickRow);
            return;
          }
          if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        autoComplete="off"
        className="w-full rounded border border-[var(--psc-border)] bg-white px-2 py-1.5 text-sm outline-none focus:border-[var(--psc-accent)]"
      />
      {canShow ? (
        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded border border-[var(--psc-border)] bg-white shadow-lg">
          {resultLabels.map((label, i) => (
            <button
              key={`${results[i]!.id}-${i}`}
              type="button"
              onClick={() => pick(results[i]!)}
              className={`block w-full px-2 py-1.5 text-left text-sm ${
                i === highlight ? "bg-[var(--psc-canvas)]" : "hover:bg-[var(--psc-canvas)]/80"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
      {loading ? <p className="mt-1 text-[10px] text-[var(--psc-muted)]">Searching…</p> : null}
    </div>
  );
}
