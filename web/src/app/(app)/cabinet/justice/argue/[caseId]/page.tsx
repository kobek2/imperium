import Link from "next/link";
import { redirect } from "next/navigation";
import { AttorneyGeneralArgumentMode } from "@/components/attorney-general-argument-mode";
import { canActAsAttorneyGeneral, canViewJusticeDepartment } from "@/lib/cabinet-hub";
import { isCourtAgenda } from "@/lib/court-case-agenda";
import type { CourtAgenda } from "@/lib/court-case-agenda";
import { fetchEffectiveRoleKeys } from "@/lib/profile-roles";
import { getServerAuth } from "@/lib/supabase/server";

export default async function CourtArgumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ caseId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ caseId }, sp] = await Promise.all([params, searchParams]);
  const sideRaw = String((sp.side as string | undefined) ?? "").trim();
  if (sideRaw !== "defend" && sideRaw !== "challenge") {
    redirect("/cabinet/justice");
  }
  const side = sideRaw as "defend" | "challenge";

  const { supabase, user } = await getServerAuth();
  if (!supabase || !user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("office_role, character_name, face_claim_url")
    .eq("id", user.id)
    .maybeSingle();
  const roleKeys = await fetchEffectiveRoleKeys(supabase, user.id, profile);
  if (!canViewJusticeDepartment(roleKeys)) redirect("/");
  if (!canActAsAttorneyGeneral(roleKeys)) redirect("/cabinet/justice");

  const { data: caseRow, error } = await supabase
    .from("rp_court_cases")
    .select("id, status, agenda")
    .eq("id", caseId)
    .maybeSingle();

  if (error || !caseRow) {
    return (
      <div className="space-y-4 p-6">
        <p className="text-sm text-[var(--psc-muted)]">Case not found.</p>
        <Link href="/cabinet/justice" className="text-sm font-semibold text-[var(--psc-accent)] underline">
          ← Back to Justice
        </Link>
      </div>
    );
  }

  const row = caseRow as { status: string; agenda: unknown };

  if (row.status !== "open") {
    return (
      <div className="mx-auto max-w-2xl space-y-6 p-6">
        <Link href="/cabinet/justice" className="text-sm font-semibold text-[var(--psc-accent)] underline">
          ← Back to Justice
        </Link>
        <h1 className="text-xl font-semibold text-[var(--psc-ink)]">Argument concluded</h1>
        <p className="text-sm text-[var(--psc-muted)]">
          This case is no longer accepting argument. Return to the docket for the latest standings and the next case.
        </p>
      </div>
    );
  }

  if (!isCourtAgenda(row.agenda)) {
    return (
      <div className="space-y-4 p-6">
        <p className="text-sm text-[var(--psc-muted)]">This case&apos;s agenda is unreadable.</p>
        <Link href="/cabinet/justice" className="text-sm font-semibold text-[var(--psc-accent)] underline">
          ← Back to Justice
        </Link>
      </div>
    );
  }

  const agenda = row.agenda as CourtAgenda;
  const agName =
    (profile as { character_name?: string | null })?.character_name?.trim() || "Attorney General";
  const agPortraitUrl =
    (profile as { face_claim_url?: string | null })?.face_claim_url?.trim() || null;

  return (
    <div className="min-h-[70vh] bg-[var(--psc-canvas)] px-4 py-8">
      <div className="mb-6 flex justify-end">
        <Link href="/cabinet/justice" className="text-xs font-semibold text-[var(--psc-muted)] underline">
          Exit to Justice docket
        </Link>
      </div>
      <AttorneyGeneralArgumentMode
        caseId={caseId}
        side={side}
        agenda={agenda}
        agName={agName}
        agPortraitUrl={agPortraitUrl}
      />
    </div>
  );
}
