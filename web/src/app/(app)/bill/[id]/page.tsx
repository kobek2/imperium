import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { tryCreateClient } from "@/lib/supabase/server";
import { processBillDeadlines } from "@/lib/bill-pipeline";
import { billStatusDisplay } from "@/lib/bill-display-status";
import { fetchEffectiveRoleKeys } from "@/lib/profile-roles";
import { canLeadershipEditBillContent } from "@/lib/role-capabilities";
import { BillBody } from "@/components/bill-body";
import { BillVoteCountdown } from "@/components/bill-vote-countdown";
import { legacyMdToEditorHtml } from "@/lib/sanitize-bill-html";
import { BillLeadershipEditForm } from "./bill-leadership-edit-form";

export default async function BillDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await tryCreateClient();
  if (!supabase) {
    return (
      <div className="border border-amber-700 bg-amber-50 p-6 text-sm text-amber-900">
        Add Supabase environment variables to view bills.
      </div>
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  await processBillDeadlines(supabase);

  const { data: bill } = await supabase
    .from("bills")
    .select(
      "id, title, content_html, content_md, status, originating_chamber, created_at, leadership_deadline_at, chamber_vote_deadline_at, vp_tie_break_pending",
    )
    .eq("id", id)
    .maybeSingle();

  if (!bill) notFound();

  const { data: profile } = await supabase
    .from("profiles")
    .select("office_role")
    .eq("id", user.id)
    .maybeSingle();

  const roleKeys = await fetchEffectiveRoleKeys(supabase, user.id, profile);
  const chamber = bill.originating_chamber as "house" | "senate";
  const canEdit =
    canLeadershipEditBillContent(roleKeys, chamber) &&
    !["law", "vetoed", "dead"].includes(bill.status);

  const versionsRes = await supabase
    .from("bill_versions")
    .select("id, content_html, created_at, edited_by")
    .eq("bill_id", id)
    .order("created_at", { ascending: false })
    .limit(12);

  const versionRows = (versionsRes.error ? [] : (versionsRes.data ?? [])) as Array<{
    id: string;
    content_html: string;
    created_at: string;
    edited_by: string;
  }>;

  const fmt = (ts: string) => new Date(ts).toLocaleString();

  const initialHtml =
    (bill as { content_html?: string | null }).content_html?.trim() ||
    legacyMdToEditorHtml((bill as { content_md?: string | null }).content_md) ||
    null;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <p className="text-sm">
        <Link href="/congress" className="font-semibold text-[var(--psc-accent)] underline">
          ← Congress
        </Link>
      </p>

      <header className="space-y-2 border-b border-[var(--psc-border)] pb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
          {billStatusDisplay(bill.status)}
        </p>
        <h1 className="text-3xl font-semibold text-[var(--psc-ink)]">{bill.title}</h1>
        <p className="text-sm text-[var(--psc-muted)]">
          Chamber:{" "}
          <strong className="text-[var(--psc-ink)]">
            {bill.originating_chamber === "house" ? "House" : "Senate"}
          </strong>
          {" · "}
          Filed {fmt(bill.created_at)}
        </p>
        {bill.status === "submitted" && bill.leadership_deadline_at ? (
          <p className="text-sm font-semibold text-amber-900">
            Leadership review deadline: {fmt(bill.leadership_deadline_at)}
          </p>
        ) : null}
        {bill.status === "on_docket" ? (
          <p className="text-sm font-semibold text-[var(--psc-ink)]">
            On the leadership docket — floor vote has not been opened yet.
          </p>
        ) : null}
        {(bill.status === "house_floor" || bill.status === "senate_floor") && bill.chamber_vote_deadline_at ? (
          <BillVoteCountdown endsAtIso={bill.chamber_vote_deadline_at} />
        ) : null}
      </header>

      <BillBody content_html={bill.content_html} content_md={bill.content_md} />

      {canEdit ? (
        <BillLeadershipEditForm billId={bill.id} initialHtml={initialHtml} />
      ) : null}

      {versionRows.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-[var(--psc-ink)]">Edit history</h2>
          <ul className="space-y-2 text-xs text-[var(--psc-muted)]">
            {versionRows.map((v) => (
              <li key={v.id} className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] px-3 py-2">
                <span className="font-mono">{fmt(v.created_at)}</span> · editor{" "}
                <Link href={`/profile/${v.edited_by}`} className="font-semibold text-[var(--psc-accent)] underline">
                  profile
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export const dynamic = "force-dynamic";
