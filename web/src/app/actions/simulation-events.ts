"use server";

import { revalidatePath } from "next/cache";
import { getServerAuth } from "@/lib/supabase/server";
import type { SimulationEventChoice } from "@/lib/simulation-events";

const VALID: SimulationEventChoice[] = ["strong", "steady", "weak", "delay"];

export async function respondToSimulationEvent(
  instanceId: string,
  choiceKey: SimulationEventChoice,
): Promise<void> {
  if (!VALID.includes(choiceKey)) throw new Error("Invalid response.");
  const { supabase, user } = await getServerAuth();
  if (!supabase || !user) throw new Error("Sign in required.");

  const { error } = await supabase.rpc("respond_simulation_event", {
    p_instance_id: instanceId,
    p_choice_key: choiceKey,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/events");
  revalidatePath("/");
  revalidatePath("/cabinet");
  revalidatePath("/oval");
}
