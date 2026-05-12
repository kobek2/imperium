import Link from "next/link";
import { notFound } from "next/navigation";
import { canViewJusticeDepartment } from "@/lib/cabinet-hub";
import { fetchEffectiveRoleKeys } from "@/lib/profile-roles";
import { getServerAuth } from "@/lib/supabase/server";

function humanizeOutcomeTier(tier: string | null): string {
  if (!tier) return "Pending";
  return tier
    .split("_")
    .map((w) => w.slice(0, 1).toUpperCase() + w.slice(1))
    .join(" ");
}

function postureLabel(side: string | null, status: string): string {
  if ((status === "open" || status === "argued") && !side) {
    return "The Department has not yet entered its appearance on the public docket; the Solicitor General's office is expected to file a notice defending, challenging, filing as amicus, or declining to defend.";
  }
  switch (side) {
    case "defend":
      return "The United States defended the underlying government position on the merits.";
    case "challenge":
      return "The United States appeared as challenger, pressing an affirmative theory against the status quo.";
    case "amicus":
      return "The Department participated as amicus curiae, briefing standards and policy context without occupying the principal party role.";
    case "decline":
      return "The United States declined to defend; argument proceeded without full-throated government advocacy for the challenged program.";
    default:
      return "No final government posture was recorded before disposition.";
  }
}

function leadParagraph(topic: string, caseLabel: string, status: string): string {
  if (status === "open") {
    return `${topic}. The Supreme Court has docketed ${caseLabel}; merits briefing is underway while the United States finalizes its litigation posture.`;
  }
  if (status === "argued") {
    return `${topic}. The United States has entered its appearance in ${caseLabel}; the Court has held oral argument and is preparing its disposition.`;
  }
  return `${topic}. The Court heard argument in ${caseLabel} after full briefing from the parties and, where the United States participated, from the Department of Justice.`;
}

export default async function DocketCaseArticlePage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const { supabase, user } = await getServerAuth();
  if (!supabase || !user) notFound();

  const { data: profile } = await supabase.from("profiles").select("office_role").eq("id", user.id).maybeSingle();
  const roleKeys = await fetchEffectiveRoleKeys(supabase, user.id, profile);
  const cabinetReader = canViewJusticeDepartment(roleKeys);

  const { data: row, error } = await supabase
    .from("rp_court_cases")
    .select(
      "id, case_label, topic, fact_pattern, question_presented, status, side_taken, outcome_tier, outcome_summary, presidential_directive, opens_at, closes_at, argued_at, updated_at",
    )
    .eq("id", caseId)
    .maybeSingle();

  if (error || !row) notFound();

  const status = String((row as { status: string }).status);
  const isDisposed = status === "closed" || status === "expired";

  const caseLabel = String((row as { case_label: string }).case_label);
  const topic = String((row as { topic: string }).topic);
  const factPattern = String((row as { fact_pattern: string }).fact_pattern);
  const questionPresented = String((row as { question_presented: string }).question_presented);
  const sideTaken = (row as { side_taken: string | null }).side_taken;
  const outcomeTier = (row as { outcome_tier: string | null }).outcome_tier;
  const outcomeSummary = (row as { outcome_summary: string | null }).outcome_summary;
  const directive = (row as { presidential_directive: string | null }).presidential_directive;
  const opensAt = String((row as { opens_at: string }).opens_at);
  const closesAt = (row as { closes_at: string | null }).closes_at;
  const arguedAt = (row as { argued_at: string | null }).argued_at;
  const updatedAt = String((row as { updated_at: string }).updated_at);

  const dateline = new Date(isDisposed ? updatedAt : opensAt).toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <article className="mx-auto max-w-3xl space-y-8 px-4 py-10">
      <header className="space-y-3 border-b border-[var(--psc-border)] pb-8">
        <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-[var(--psc-muted)]">
          {isDisposed ? "Special report · Federal docket" : "Dispatch · Federal docket"}
        </p>
        <h1 className="text-3xl font-bold leading-tight tracking-tight text-[var(--psc-ink)]">{caseLabel}</h1>
        <p className="text-sm text-[var(--psc-muted)]">
          <time dateTime={opensAt}>{dateline}</time>
          {arguedAt ? (
            <>
              {" "}
              · Oral argument concluded{" "}
              <time dateTime={arguedAt}>
                {new Date(arguedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
              </time>
            </>
          ) : null}
        </p>
        {!isDisposed ? (
          <p className="rounded border border-amber-600 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            {status === "open"
              ? "Case is open on the national docket. The Attorney General must enter an appearance before the statutory window closes."
              : "The Court has received argument; a disposition will issue when the Justices complete conference."}
            {closesAt ? (
              <>
                {" "}
                Docket window runs through{" "}
                <time dateTime={closesAt} className="font-semibold">
                  {new Date(closesAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                </time>
                .
              </>
            ) : null}
            {cabinetReader ? (
              <>
                {" "}
                <Link href="/cabinet/justice" className="font-semibold text-[var(--psc-accent)] underline">
                  Justice workbench (cabinet) →
                </Link>
              </>
            ) : null}
          </p>
        ) : null}
      </header>

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">Lead</h2>
        <p className="text-lg leading-relaxed text-[var(--psc-ink)]">
          <span className="font-semibold">WASHINGTON</span> — {leadParagraph(topic, caseLabel, status)}
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">Background</h2>
        <p className="text-base leading-relaxed text-[var(--psc-ink)]">{factPattern}</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">Question presented</h2>
        <p className="text-base leading-relaxed italic text-[var(--psc-ink)]">{questionPresented}</p>
      </section>

      {directive ? (
        <section className="space-y-2 rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)]/60 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">
            Inter-branch context
          </h2>
          <p className="text-sm leading-relaxed text-[var(--psc-ink)]">
            The President issued an advisory directive to <strong>{directive}</strong> the government&apos;s
            position. The Attorney General retained independent litigation discretion; any departure could influence
            public confidence when the judgment landed.
          </p>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">
          Argument and government posture
        </h2>
        <p className="text-base leading-relaxed text-[var(--psc-ink)]">{postureLabel(sideTaken, status)}</p>
      </section>

      {isDisposed ? (
        <section className="space-y-4 rounded-lg border-2 border-[var(--psc-border)] bg-[var(--psc-panel)] p-6 shadow-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--psc-muted)]">
              Judgment of the Court
            </h2>
            <span className="rounded-full bg-[var(--psc-canvas)] px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-[var(--psc-ink)]">
              {humanizeOutcomeTier(outcomeTier)}
            </span>
          </div>
          <p className="text-base leading-relaxed text-[var(--psc-ink)]">
            {outcomeSummary ??
              "The Court filed its disposition; a fuller opinion summary will be wired from the docket clerk."}
          </p>
        </section>
      ) : null}

      <footer className="border-t border-[var(--psc-border)] pt-6 text-sm text-[var(--psc-muted)]">
        <Link href="/inbox" className="font-semibold text-[var(--psc-accent)] underline-offset-4 hover:underline">
          ← Back to inbox
        </Link>
        {cabinetReader ? (
          <>
            {" · "}
            <Link href="/cabinet/justice" className="font-semibold text-[var(--psc-accent)] underline-offset-4 hover:underline">
              Justice department
            </Link>
          </>
        ) : null}
      </footer>
    </article>
  );
}
