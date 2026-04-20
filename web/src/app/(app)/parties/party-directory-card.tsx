import Link from "next/link";

function PartyMark({ partyKey }: { partyKey: "democrat" | "republican" }) {
  if (partyKey === "democrat") {
    return (
      <div
        className="flex h-[4.5rem] w-[4.5rem] shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#0a1744] via-[#122f5c] to-[#1e4976] text-3xl font-bold tracking-tight text-white shadow-lg shadow-blue-950/25 ring-2 ring-white/35"
        aria-hidden
      >
        D
      </div>
    );
  }
  return (
    <div
      className="flex h-[4.5rem] w-[4.5rem] shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#7f0f1f] via-[#b91c3c] to-[#dc2626] text-3xl font-bold tracking-tight text-white shadow-lg shadow-rose-950/25 ring-2 ring-white/35"
      aria-hidden
    >
      R
    </div>
  );
}

export function PartyDirectoryCard({
  partyKey,
  title,
  treasury,
  members,
}: {
  partyKey: "democrat" | "republican";
  title: string;
  treasury: number;
  members: number;
}) {
  const isDem = partyKey === "democrat";
  const shell = isDem
    ? "border-blue-200/80 bg-gradient-to-br from-slate-50 via-white to-blue-50/90 shadow-sm shadow-blue-900/5 ring-1 ring-blue-900/10"
    : "border-rose-200/80 bg-gradient-to-br from-slate-50 via-white to-rose-50/90 shadow-sm shadow-rose-900/5 ring-1 ring-rose-900/10";

  return (
    <li>
      <Link
        href={`/parties/${partyKey}`}
        aria-label={`${title}: open party room`}
        className={`group flex flex-col overflow-hidden rounded-2xl border ${shell} transition hover:-translate-y-0.5 hover:shadow-md`}
      >
        <div className="flex flex-wrap items-center gap-5 p-6 sm:flex-nowrap">
          <PartyMark partyKey={partyKey} />
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold tracking-tight text-[var(--psc-ink)]">{title}</h2>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="inline-flex items-center rounded-full border border-[var(--psc-border)] bg-white/90 px-3 py-1 font-mono text-sm font-semibold tabular-nums text-[var(--psc-ink)] shadow-sm">
                Treasury ${treasury.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
              <span className="inline-flex items-center rounded-full border border-[var(--psc-border)] bg-white/60 px-3 py-1 text-sm font-medium text-[var(--psc-ink)]">
                {members} member{members === 1 ? "" : "s"}
              </span>
            </div>
          </div>
        </div>
        <div
          className={`flex items-center justify-between gap-3 border-t px-6 py-3.5 ${
            isDem ? "border-blue-200/60 bg-blue-950/[0.03]" : "border-rose-200/60 bg-rose-950/[0.03]"
          }`}
        >
          <span className="text-xs font-medium text-[var(--psc-muted)]">Officers, votes, and party feed</span>
          <span
            className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition group-hover:gap-2 ${
              isDem ? "bg-[#0a1744] group-hover:bg-[#152a52]" : "bg-[#9f1239] group-hover:bg-[#b91c48]"
            }`}
          >
            Party room
            <span aria-hidden className="transition-transform group-hover:translate-x-0.5">
              →
            </span>
          </span>
        </div>
      </Link>
    </li>
  );
}
