import Link from "next/link";
import type { LeaderSlot } from "@/lib/congress-composition";
import { profilePath } from "@/components/profile-card";

function partyDotClass(p: string | null | undefined) {
  if (p === "democrat") return "bg-blue-600";
  if (p === "republican") return "bg-red-600";
  if (p === "independent") return "bg-slate-600";
  return "bg-slate-300";
}

export function CongressLeadersPanel({
  heading,
  subheading,
  slots,
  shellClassName,
  headingClassName,
}: {
  heading: string;
  subheading?: string;
  slots: LeaderSlot[];
  shellClassName: string;
  headingClassName: string;
}) {
  return (
    <section className={`rounded-xl border-2 shadow-sm ${shellClassName}`}>
      <header className={`border-b px-5 py-4 ${headingClassName}`}>
        <h2 className="text-lg font-semibold tracking-tight">{heading}</h2>
        {subheading ? (
          <p className="mt-1 text-sm leading-relaxed text-[var(--psc-muted)]">{subheading}</p>
        ) : null}
      </header>
      <ul className="divide-y divide-[var(--psc-border)] p-0">
        {slots.map((slot) => (
          <li key={slot.roleKey} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3">
            <p className="min-w-[10rem] text-sm font-semibold text-[var(--psc-ink)]">{slot.label}</p>
            <div className="min-w-0 flex-1 text-right">
              {slot.holders.length === 0 ? (
                <p className="text-sm text-[var(--psc-muted)]">Vacant</p>
              ) : (
                <ul className="space-y-1">
                  {slot.holders.map((h) => (
                    <li key={h.id} className="flex items-center justify-end gap-2 text-sm">
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${partyDotClass(h.party)}`}
                        aria-hidden
                      />
                      <Link
                        href={profilePath(h.id) ?? "#"}
                        className="font-medium text-[var(--psc-accent)] hover:underline"
                      >
                        {h.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
