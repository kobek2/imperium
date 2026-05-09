import { redirect } from "next/navigation";
import { BriefingInbox } from "@/components/briefing-inbox";
import { fetchBriefingMoments, INBOX_FULL_PAGE_LIMIT } from "@/lib/briefing-inbox";
import { getServerAuth } from "@/lib/supabase/server";

export default async function InboxPage() {
  const { supabase, user } = await getServerAuth();
  if (!supabase) {
    return (
      <div className="border border-amber-700 bg-amber-50 p-6 text-sm text-amber-900">
        Add Supabase environment variables to load your inbox.
      </div>
    );
  }

  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("party").eq("id", user.id).maybeSingle();
  if (!profile?.party) {
    redirect("/character");
  }

  const moments = await fetchBriefingMoments(supabase, user.id);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--psc-ink)]">Inbox</h1>
      </header>

      <BriefingInbox moments={moments} heading="All mail" />

      <p className="text-xs text-[var(--psc-muted)]">
        This page lists up to your {INBOX_FULL_PAGE_LIMIT} most recent inbox messages.
      </p>
    </div>
  );
}
