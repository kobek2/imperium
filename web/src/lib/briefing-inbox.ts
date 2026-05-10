import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Home inbox reads `inbox_items`: rows are inserted by Postgres triggers when elections close,
 * bill status changes, or party officer seats change (see migration `20260450000000_inbox_items_true_inbox.sql`).
 * That is a "true" inbox: durable, deduped, and ready for read/unread later.
 */
export type BriefingMomentKind =
  | "election_win"
  | "bill_milestone"
  | "party_leadership"
  | "whip_instruction"
  | "executive_order"
  | "diplomatic_crisis"
  | "fiscal_year_report"
  | "court_case_filed"
  | "court_directive_issued"
  | "court_ruling";

export type BriefingMoment = {
  id: string;
  kind: BriefingMomentKind;
  /** When the notification was created (ISO). */
  at: string;
  title: string;
  body: string;
  href: string;
  accent: "win" | "legislation" | "party" | "court";
  readAt: string | null;
};

function accentForKind(kind: string): BriefingMoment["accent"] {
  if (kind === "election_win") return "win";
  if (kind === "bill_milestone") return "legislation";
  if (kind === "whip_instruction") return "legislation";
  if (kind === "executive_order") return "legislation";
  if (kind === "diplomatic_crisis") return "legislation";
  if (kind === "fiscal_year_report") return "legislation";
  if (kind === "court_case_filed") return "court";
  if (kind === "court_directive_issued") return "court";
  if (kind === "court_ruling") return "court";
  if (kind === "party_leadership") return "party";
  return "win";
}

/** Default cap for `/inbox` and other full-list callers. */
export const INBOX_FULL_PAGE_LIMIT = 100;

export async function fetchBriefingMoments(
  supabase: SupabaseClient,
  userId: string,
  limit: number = INBOX_FULL_PAGE_LIMIT,
): Promise<BriefingMoment[]> {
  const cap = Math.min(Math.max(1, limit), 500);
  const { data, error } = await supabase
    .from("inbox_items")
    .select("id, kind, title, body, href, read_at, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(cap);

  if (error) {
    // Table missing until migration is applied — avoid breaking the home page.
    const msg = error.message.toLowerCase();
    if (
      error.code === "42P01" ||
      error.code === "PGRST205" ||
      msg.includes("inbox_items") ||
      msg.includes("schema cache")
    ) {
      return [];
    }
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => {
    const r = row as {
      id: string;
      kind: string;
      title: string;
      body: string;
      href: string;
      read_at: string | null;
      created_at: string;
    };
    return {
      id: r.id,
      kind: r.kind as BriefingMomentKind,
      at: r.created_at,
      title: r.title,
      body: r.body,
      href: r.href,
      accent: accentForKind(r.kind),
      readAt: r.read_at,
    };
  });
}
