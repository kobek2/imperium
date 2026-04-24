import { getServerAuth } from "@/lib/supabase/server";
import {
  computeSimulationRpInstant,
  formatRpCalendarShort,
  type SimulationSettingsRow,
} from "@/lib/simulation-calendar";
import { resolveSimulationSettingsForWidget } from "@/lib/simulation-widget-data";

export async function AppChromeRpCorner({ canPersistSimHeal }: { canPersistSimHeal: boolean }) {
  const { supabase, user } = await getServerAuth();
  if (!supabase || !user) return null;

  const { data: simRow, error } = await supabase.from("simulation_settings").select("*").eq("id", 1).maybeSingle();
  if (error || !simRow) return null;

  const effective = await resolveSimulationSettingsForWidget(
    supabase,
    simRow as SimulationSettingsRow,
    canPersistSimHeal,
  );
  const label = formatRpCalendarShort(computeSimulationRpInstant(effective, new Date()));

  return (
    <div
      className="fixed bottom-4 right-4 z-[100] rounded-md border border-[var(--psc-border)] bg-[var(--psc-panel)]/95 px-3 py-2 text-right shadow-md backdrop-blur-sm"
      title="Simulation calendar date (admins: align anchors under Admin → Elections if this looks wrong)"
    >
      <p className="font-mono text-sm font-semibold tabular-nums tracking-tight text-[var(--psc-ink)]">{label}</p>
    </div>
  );
}
