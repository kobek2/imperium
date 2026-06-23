import Link from "next/link";
import { FormSubmitButton } from "@/components/form-submit-button";
import {
  beginAllCongressionalSeatFilings,
  beginHouseCongressionalSeatFilings,
  beginPresidentDormantSeatFilings,
  beginSenateClass1SeatFilings,
  beginSenateClass2SeatFilings,
  beginSenateClass3SeatFilings,
} from "@/app/actions/simulation";
import {
  closeHouseSeatElections,
  closePresidentSeatElections,
  closeSenateClass1SeatElections,
  closeSenateClass2SeatElections,
  closeSenateClass3SeatElections,
} from "@/app/actions/elections";

const beginBtn =
  "w-full rounded border border-emerald-900/50 bg-emerald-950 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-emerald-50 hover:bg-emerald-900/90";
const closeBtn =
  "w-full rounded border border-rose-900/50 bg-rose-950 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-rose-50 hover:bg-rose-900/90";

const SENATE_CLASS_LABELS: Record<1 | 2 | 3, string> = {
  1: "Northeast & Midwest Seat 1 and South Seat 1",
  2: "South Seat 2 and West Seat 1",
  3: "Northeast & Midwest Seat 2 and West Seat 2",
};

export function AdminElectionSimulationButtons() {
  return (
    <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-[var(--psc-ink)]">Seat elections</h3>
      <p className="mt-1 text-[11px] text-[var(--psc-muted)]">
        Chamber leadership (caucus) races:{" "}
        <Link href="/admin/leadership-elections" className="font-semibold text-[var(--psc-accent)] underline underline-offset-2">
          Admin → Leadership elections
        </Link>
        .
      </p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--psc-muted)]">Begin</p>
          <div className="mt-2 flex flex-col gap-2">
            <form action={beginAllCongressionalSeatFilings}>
              <FormSubmitButton
                idleLabel="Begin all seat elections (10 House + 6 Senate)"
                pendingLabel="Opening…"
                className={beginBtn}
              />
            </form>
            <form action={beginHouseCongressionalSeatFilings}>
              <FormSubmitButton
                idleLabel="Begin all house elections (10 districts)"
                pendingLabel="Opening…"
                className={beginBtn}
              />
            </form>
            <form action={beginSenateClass1SeatFilings}>
              <FormSubmitButton
                idleLabel={`Begin ${SENATE_CLASS_LABELS[1]}`}
                pendingLabel="Opening…"
                className={beginBtn}
              />
            </form>
            <form action={beginSenateClass2SeatFilings}>
              <FormSubmitButton
                idleLabel={`Begin ${SENATE_CLASS_LABELS[2]}`}
                pendingLabel="Opening…"
                className={beginBtn}
              />
            </form>
            <form action={beginSenateClass3SeatFilings}>
              <FormSubmitButton
                idleLabel={`Begin ${SENATE_CLASS_LABELS[3]}`}
                pendingLabel="Opening…"
                className={beginBtn}
              />
            </form>
            <form action={beginPresidentDormantSeatFilings}>
              <FormSubmitButton
                idleLabel="Begin presidential races"
                pendingLabel="Opening…"
                className={beginBtn}
              />
            </form>
          </div>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--psc-muted)]">Close</p>
          <div className="mt-2 flex flex-col gap-2">
            <form action={closeHouseSeatElections}>
              <FormSubmitButton idleLabel="Close house elections" pendingLabel="Closing…" className={closeBtn} />
            </form>
            <form action={closeSenateClass1SeatElections}>
              <FormSubmitButton
                idleLabel={`Close ${SENATE_CLASS_LABELS[1]}`}
                pendingLabel="Closing…"
                className={closeBtn}
              />
            </form>
            <form action={closeSenateClass2SeatElections}>
              <FormSubmitButton
                idleLabel={`Close ${SENATE_CLASS_LABELS[2]}`}
                pendingLabel="Closing…"
                className={closeBtn}
              />
            </form>
            <form action={closeSenateClass3SeatElections}>
              <FormSubmitButton
                idleLabel={`Close ${SENATE_CLASS_LABELS[3]}`}
                pendingLabel="Closing…"
                className={closeBtn}
              />
            </form>
            <form action={closePresidentSeatElections}>
              <FormSubmitButton idleLabel="Close presidential elections" pendingLabel="Closing…" className={closeBtn} />
            </form>
          </div>
        </div>
      </div>
    </section>
  );
}
