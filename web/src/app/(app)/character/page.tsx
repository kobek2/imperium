import { redirect } from "next/navigation";
import { RecentAuthoredBillsPanel } from "@/components/recent-authored-bills-panel";
import { getServerAuth } from "@/lib/supabase/server";
import { pickDiscordUsername } from "@/lib/discord-username";
import { isProfileOnboardingComplete } from "@/lib/character-onboarding";
import { formatPrimaryGovernmentTitle } from "@/lib/government-role-display";
import {
  fetchRecentAuthoredBillsWithSubjectVotes,
  type AuthorBillVote,
  type RecentAuthoredBill,
} from "@/lib/profile-recent-bills";
import { fetchEffectiveRoleKeys } from "@/lib/profile-roles";
import { PersonnelEditShell } from "./personnel-edit-shell";
import type { PersonnelProfile } from "./personnel-record";

export default async function CharacterPage() {
  const { supabase, user } = await getServerAuth();
  if (!supabase) {
    return (
      <div className="border border-amber-700 bg-amber-50 p-6 text-sm text-amber-900">
        Configure Supabase keys in <code className="font-mono">web/.env.local</code>{" "}
        to enable character creation.
      </div>
    );
  }

  if (!user) {
    redirect("/login");
  }

  let { data: profile } = await supabase
    .from("profiles")
    .select(
      "character_name, date_of_birth, residence_state, home_district_code, party, bio, face_claim_url, former_positions, discord_username, office_role",
    )
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) {
    redirect("/login");
  }

  const meta = user.user_metadata as Record<string, unknown> | undefined;
  const idData = user.identities?.[0]?.identity_data as Record<string, unknown> | undefined;
  const syncedName = pickDiscordUsername(meta) ?? pickDiscordUsername(idData);
  if (syncedName && syncedName !== profile.discord_username) {
    await supabase.from("profiles").update({ discord_username: syncedName }).eq("id", user.id);
    profile = { ...profile, discord_username: syncedName };
  }

  const roleKeys = await fetchEffectiveRoleKeys(supabase, user.id, profile);
  const primaryTitle = formatPrimaryGovernmentTitle(roleKeys);

  const personnelProfile: PersonnelProfile = {
    character_name: profile.character_name,
    date_of_birth: profile.date_of_birth,
    residence_state: profile.residence_state,
    home_district_code: profile.home_district_code,
    party: profile.party,
    bio: profile.bio,
    face_claim_url: profile.face_claim_url,
    former_positions: profile.former_positions,
    discord_username: profile.discord_username,
  };

  let districtPvi: number | null = null;
  if (profile.home_district_code) {
    const { data: districtRow } = await supabase
      .from("districts")
      .select("pvi")
      .eq("code", profile.home_district_code)
      .maybeSingle();
    const raw = (districtRow as { pvi?: number | null } | null)?.pvi;
    districtPvi = typeof raw === "number" ? raw : null;
  }

  const setupMode = !isProfileOnboardingComplete(profile);

  const recentAuthored = setupMode
    ? {
        bills: [] as RecentAuthoredBill[],
        votes: [] as AuthorBillVote[],
        floorTallies: new Map(),
        confirmationBillIds: new Set<string>(),
        rejectionActorDisplayByBillId: new Map<string, string | null>(),
      }
    : await fetchRecentAuthoredBillsWithSubjectVotes(supabase, user.id, 5);

  return (
    <div className="space-y-10">
      <PersonnelEditShell
        primaryTitle={primaryTitle}
        profile={personnelProfile}
        districtPvi={districtPvi}
        setupMode={setupMode}
      />
      {!setupMode ? (
        <RecentAuthoredBillsPanel
          bills={recentAuthored.bills}
          votes={recentAuthored.votes}
          floorTallies={recentAuthored.floorTallies}
          confirmationBillIds={recentAuthored.confirmationBillIds}
          rejectionActorDisplayByBillId={recentAuthored.rejectionActorDisplayByBillId}
        />
      ) : null}
    </div>
  );
}
