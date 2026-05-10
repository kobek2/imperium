import { formatRpCalendarShort, type SimulationRpInstant } from "@/lib/simulation-calendar";
import { RpDatePill } from "@/components/rp-date-pill";

/** Same compact RP date as the home header (`formatRpCalendarShort`). */
export function SimulationRpBanner({ rp }: { rp: SimulationRpInstant }) {
  return <RpDatePill label={formatRpCalendarShort(rp)} />;
}
