import Link from "next/link";
import { redirect } from "next/navigation";
import { DiplomaticStoryMode } from "@/components/diplomatic-story-mode";
import { canActAsSecretaryOfState, canViewStateDepartment } from "@/lib/cabinet-hub";
import { isStorySessionAgenda } from "@/lib/diplomatic-story";
import type { DiplomaticStoryScript } from "@/lib/diplomatic-story";
import { fetchEffectiveRoleKeys } from "@/lib/profile-roles";
import { getServerAuth } from "@/lib/supabase/server";

export default async function DiplomaticDialoguePage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const { supabase, user } = await getServerAuth();
  if (!supabase || !user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("office_role, character_name, face_claim_url")
    .eq("id", user.id)
    .maybeSingle();
  const roleKeys = await fetchEffectiveRoleKeys(supabase, user.id, profile);
  if (!canViewStateDepartment(roleKeys)) redirect("/");
  if (!canActAsSecretaryOfState(roleKeys)) redirect("/cabinet/state");

  const { data: session, error } = await supabase
    .from("rp_diplomatic_sessions")
    .select("id, user_id, status, agenda, mode")
    .eq("id", sessionId)
    .maybeSingle();

  if (error || !session) {
    return (
      <div className="space-y-4 p-6">
        <p className="text-sm text-[var(--psc-muted)]">Session not found.</p>
        <Link href="/cabinet/state" className="text-sm font-semibold text-[var(--psc-accent)] underline">
          ← Back to State
        </Link>
      </div>
    );
  }

  const row = session as { user_id: string; status: string; agenda: unknown; mode: string };
  if (row.user_id !== user.id) {
    redirect("/cabinet/state");
  }
  if (row.mode !== "intensive") {
    redirect("/cabinet/state");
  }
  if (!isStorySessionAgenda(row.agenda)) {
    return (
      <div className="space-y-4 p-6">
        <p className="text-sm text-[var(--psc-muted)]">This session cannot be opened in story mode.</p>
        <Link href="/cabinet/state" className="text-sm font-semibold text-[var(--psc-accent)] underline">
          ← Back to State
        </Link>
      </div>
    );
  }

  const script = row.agenda as DiplomaticStoryScript;
  const secretaryName =
    (profile as { character_name?: string | null })?.character_name?.trim() ||
    "Secretary of State";
  const secretaryPortraitUrl =
    (profile as { face_claim_url?: string | null })?.face_claim_url?.trim() || null;

  if (row.status === "closed") {
    return (
      <div className="mx-auto max-w-2xl space-y-6 p-6">
        <Link href="/cabinet/state" className="text-sm font-semibold text-[var(--psc-accent)] underline">
          ← Back to State
        </Link>
        <h1 className="text-xl font-semibold text-[var(--psc-ink)]">Dialogue complete</h1>
        <p className="text-sm text-[var(--psc-muted)]">
          This session is already closed. Relationship changes are on file; return to the State dashboard for the latest
          standings.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-[70vh] bg-[var(--psc-canvas)] px-4 py-8">
      <div className="mb-6 flex justify-end">
        <Link href="/cabinet/state" className="text-xs font-semibold text-[var(--psc-muted)] underline">
          Exit to State dashboard
        </Link>
      </div>
      <DiplomaticStoryMode
        script={script}
        sessionId={sessionId}
        secretaryName={secretaryName}
        secretaryPortraitUrl={secretaryPortraitUrl}
      />
    </div>
  );
}
