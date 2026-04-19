import Link from "next/link";
import { markInboxItemRead } from "@/app/actions/inbox";
import { SubmitButton } from "@/components/submit-button";
import type { BriefingMoment } from "@/lib/briefing-inbox";

function accentClass(accent: BriefingMoment["accent"], unread: boolean) {
  const base =
    accent === "win"
      ? "border-l-emerald-600 bg-gradient-to-r from-emerald-50/90 to-[var(--psc-panel)]"
      : accent === "legislation"
        ? "border-l-amber-600 bg-gradient-to-r from-amber-50/80 to-[var(--psc-panel)]"
        : accent === "party"
          ? "border-l-violet-600 bg-gradient-to-r from-violet-50/80 to-[var(--psc-panel)]"
          : "border-l-[var(--psc-accent)] bg-[var(--psc-panel)]";
  return `${base} ${unread ? "ring-1 ring-inset ring-[var(--psc-accent)]/25" : ""}`;
}

function kindEyebrow(kind: BriefingMoment["kind"]) {
  switch (kind) {
    case "election_win":
      return "Election";
    case "bill_milestone":
      return "Legislation";
    case "party_leadership":
      return "Party";
    default:
      return "Update";
  }
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = Date.now();
  const diff = now - d.getTime();
  const day = 86400000;
  if (diff < 60000) return "Just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
  if (diff < day) return `${Math.floor(diff / 3600000)} hr ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)} days ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function BriefingInbox({ moments }: { moments: BriefingMoment[] }) {
  if (!moments.length) {
    return (
      <section className="overflow-hidden rounded-xl border border-[var(--psc-border)] bg-[var(--psc-panel)] shadow-sm">
        <div className="border-b border-[var(--psc-border)] bg-[color-mix(in_srgb,var(--psc-ink)_4%,transparent)] px-5 py-4">
          <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Your inbox</h2>
          <p className="mt-1 text-sm text-[var(--psc-muted)]">
            Stored notifications from the simulation (election results, bill milestones, party leadership). Apply the
            inbox migration so rows appear here; until then this stays empty.
          </p>
        </div>
        <div className="px-5 py-10 text-center">
          <p className="text-sm font-medium text-[var(--psc-ink)]">Nothing in your inbox yet</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-[var(--psc-muted)]">
            When you win a race, your bill reaches a major step, or you take a party officer seat, a note is saved here
            automatically.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-xl border border-[var(--psc-border)] bg-[var(--psc-panel)] shadow-sm">
      <div className="border-b border-[var(--psc-border)] bg-[color-mix(in_srgb,var(--psc-ink)_4%,transparent)] px-5 py-4">
        <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Your inbox</h2>
        <p className="mt-1 text-sm text-[var(--psc-muted)]">
          Notifications stored for your account. Open a row to jump in, or mark it read when you have caught up.
        </p>
      </div>
      <ul className="divide-y divide-[var(--psc-border)]">
        {moments.map((m) => {
          const unread = m.readAt == null;
          return (
            <li key={m.id}>
              <div
                className={`flex flex-col gap-3 border-l-4 px-5 py-4 sm:flex-row sm:items-stretch sm:justify-between ${accentClass(m.accent, unread)}`}
              >
                <Link href={m.href} className="group min-w-0 flex-1">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">
                    {kindEyebrow(m.kind)}
                    {unread ? (
                      <span className="ml-2 rounded bg-[var(--psc-ink)] px-1.5 py-0.5 text-[9px] font-bold text-white">
                        New
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-1 text-base font-semibold text-[var(--psc-ink)] group-hover:underline">{m.title}</p>
                  <p className="mt-1 line-clamp-2 text-sm text-[var(--psc-muted)]">{m.body}</p>
                  <p className="mt-2 text-xs font-semibold text-[var(--psc-accent)] group-hover:underline">Open →</p>
                </Link>
                <div className="flex shrink-0 flex-row items-end justify-between gap-3 sm:flex-col sm:items-end">
                  <time className="text-xs tabular-nums text-[var(--psc-muted)]" dateTime={m.at}>
                    {formatWhen(m.at)}
                  </time>
                  {unread ? (
                    <form action={markInboxItemRead}>
                      <input type="hidden" name="id" value={m.id} />
                      <SubmitButton
                        variant="ghost"
                        pendingLabel="Saving…"
                        className="rounded border border-[var(--psc-border)] bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-ink)]"
                      >
                        Mark read
                      </SubmitButton>
                    </form>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
