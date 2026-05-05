import { redirect } from "next/navigation";
import { getServerAuth } from "@/lib/supabase/server";
import { isProfileOnboardingComplete } from "@/lib/character-onboarding";
import { orientationStepOrDefault } from "@/lib/orientation-tour";

/** Legacy URL: guided tour now lives on Elections / Economy / Congress with step routing. */
export default async function WelcomeRedirectPage() {
  const { supabase, user } = await getServerAuth();
  if (!supabase || !user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "character_name, date_of_birth, residence_state, home_district_code, party, orientation_completed_at, orientation_step",
    )
    .eq("id", user.id)
    .maybeSingle();

  if (!isProfileOnboardingComplete(profile)) redirect("/onboarding");
  if (profile?.orientation_completed_at) redirect("/");

  const step = orientationStepOrDefault(profile?.orientation_step ?? null);
  if (step === 2) redirect("/economy");
  if (step === 3) redirect("/congress");
  redirect("/elections");
}
