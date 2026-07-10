"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { nonClosedElectionIds } from "@/lib/orientation-tour";

async function loadOrientationState(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("orientation_completed_at, orientation_step")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return profile as {
    orientation_completed_at: string | null;
    orientation_step: number | null;
  } | null;
}

/** Skip the guided tour from any step. */
export async function completeWelcomeTour(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const { error } = await supabase
    .from("profiles")
    .update({
      orientation_completed_at: new Date().toISOString(),
      orientation_step: null,
    })
    .eq("id", user.id);

  if (error) throw new Error(error.message);

  revalidatePath("/elections");
  revalidatePath("/economy");
  revalidatePath("/mayor");
  revalidatePath("/");
  redirect("/");
}

export async function advanceFromElectionStep(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const state = await loadOrientationState(supabase, user.id);
  if (state?.orientation_completed_at) redirect("/");
  const step = state?.orientation_step ?? 1;
  if (step !== 1) {
    redirect(step === 2 ? "/economy" : step === 3 ? "/mayor" : "/elections");
  }

  const { data: elections } = await supabase
    .from("elections")
    .select("id, phase, leadership_role")
    .neq("phase", "closed");

  const openIds = nonClosedElectionIds(
    (elections ?? []) as Array<{ id: string; phase: string; leadership_role: string | null }>,
  );

  if (openIds.length > 0) {
    const { data: cand } = await supabase
      .from("election_candidates")
      .select("id")
      .eq("user_id", user.id)
      .in("election_id", openIds)
      .limit(1)
      .maybeSingle();
    if (!cand) {
      throw new Error(
        "File for at least one race that is not closed yet (or use Skip tour if nothing fits your character yet).",
      );
    }
  }

  const { error } = await supabase.from("profiles").update({ orientation_step: 2 }).eq("id", user.id);
  if (error) throw new Error(error.message);

  revalidatePath("/elections");
  revalidatePath("/economy");
  redirect("/economy");
}

export async function advanceFromEconomyStep(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const state = await loadOrientationState(supabase, user.id);
  if (state?.orientation_completed_at) redirect("/");
  const st = state?.orientation_step ?? 1;
  if (st !== 2) {
    redirect(st === 1 ? "/elections" : st === 3 ? "/mayor" : "/elections");
  }

  const { count } = await supabase
    .from("economy_ledger")
    .select("*", { count: "exact", head: true })
    .eq("wallet_user_id", user.id);

  if (!count || count < 1) {
    throw new Error(
      "Use Collect income or try Blackjack on this page so your ledger has at least one entry, then continue.",
    );
  }

  const { error } = await supabase.from("profiles").update({ orientation_step: 3 }).eq("id", user.id);
  if (error) throw new Error(error.message);

  revalidatePath("/economy");
  revalidatePath("/mayor");
  redirect("/mayor");
}

export async function finishOrientationFromCityHall(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const state = await loadOrientationState(supabase, user.id);
  if (state?.orientation_completed_at) redirect("/");
  const st3 = state?.orientation_step ?? 1;
  if (st3 !== 3) {
    redirect(st3 === 1 ? "/elections" : st3 === 2 ? "/economy" : "/elections");
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      orientation_completed_at: new Date().toISOString(),
      orientation_step: null,
    })
    .eq("id", user.id);

  if (error) throw new Error(error.message);

  revalidatePath("/mayor");
  revalidatePath("/");
  redirect("/");
}

/** @deprecated Use finishOrientationFromCityHall */
export async function finishOrientationFromCongress(): Promise<void> {
  return finishOrientationFromCityHall();
}
