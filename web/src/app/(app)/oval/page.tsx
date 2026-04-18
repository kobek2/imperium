import { redirect } from "next/navigation";
import { tryCreateClient } from "@/lib/supabase/server";
import { createAppointment, presidentialAction } from "@/app/actions/bills";
import { SubmitButton } from "@/components/submit-button";
import { processBillDeadlines } from "@/lib/bill-pipeline";
import { fetchEffectiveRoleKeys } from "@/lib/profile-roles";
import { canActAsPresident } from "@/lib/role-capabilities";

export default async function OvalPage() {
  const supabase = await tryCreateClient();
  if (!supabase) {
    return (
      <div className="border border-amber-700 bg-amber-50 p-6 text-sm text-amber-900">
        Add Supabase environment variables to unlock the Oval Office.
      </div>
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  await processBillDeadlines(supabase);

  const { data: profile } = await supabase
    .from("profiles")
    .select("office_role")
    .eq("id", user.id)
    .maybeSingle();

  const roleKeys = await fetchEffectiveRoleKeys(supabase, user.id, profile);
  const president = canActAsPresident(roleKeys);

  const { data: desk } = await supabase
    .from("bills")
    .select("id, title, status, created_at")
    .eq("status", "oval")
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-3xl font-semibold">Executive desk</h1>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-[var(--psc-muted)]">
          Signing or vetoing updates the statute line immediately. Cabinet and SCOTUS
          picks generate Senate confirmation bills automatically.
        </p>
      </header>

      {president ? (
        <section className="border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
          <h2 className="text-lg font-semibold">Appointment + confirmation</h2>
          <form action={createAppointment} className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="grid gap-2 text-sm font-semibold">
              Office title
              <input
                name="title"
                required
                className="border border-[var(--psc-border)] bg-white px-3 py-2 font-normal"
              />
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              Kind
              <select
                name="kind"
                className="border border-[var(--psc-border)] bg-white px-3 py-2 font-normal"
              >
                <option value="cabinet">Cabinet</option>
                <option value="scotus">Supreme Court</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label className="grid gap-2 text-sm font-semibold md:col-span-2">
              Nominee Discord user id (snowflake)
              <input
                name="nominee_discord"
                required
                className="border border-[var(--psc-border)] bg-white px-3 py-2 font-mono text-sm"
              />
            </label>
            <button
              type="submit"
              className="border border-[var(--psc-border)] bg-[var(--psc-ink)] px-4 py-2 text-sm font-semibold uppercase tracking-wide text-white md:col-span-2"
            >
              Transmit nomination
            </button>
          </form>
        </section>
      ) : (
        <p className="text-sm text-[var(--psc-muted)]">
          Oval tools unlock when the user has the <code className="font-mono">president</code>{" "}
          grant (or <code className="font-mono">admin</code>) via{" "}
          <code className="font-mono">government_role_grants</code> or legacy{" "}
          <code className="font-mono">profiles.office_role</code>.
        </p>
      )}

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Awaiting signature</h2>
        {!desk?.length ? (
          <p className="text-sm text-[var(--psc-muted)]">No bills on the desk.</p>
        ) : (
          <div className="space-y-4">
            {desk.map((bill) => (
              <article
                key={bill.id}
                className="border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5"
              >
                <h3 className="text-lg font-semibold">{bill.title}</h3>
                <p className="text-xs text-[var(--psc-muted)]">
                  Status {bill.status} · {new Date(bill.created_at).toLocaleString()}
                </p>
                {president ? (
                  <form action={presidentialAction} className="mt-4 flex gap-3">
                    <input type="hidden" name="bill_id" value={bill.id} />
                    <SubmitButton
                      name="action"
                      value="sign"
                      pendingLabel="Signing…"
                      className="border border-green-800 bg-green-900 px-4 py-2 text-sm font-semibold uppercase tracking-wide text-white transition hover:brightness-110"
                    >
                      Sign
                    </SubmitButton>
                    <SubmitButton
                      name="action"
                      value="veto"
                      pendingLabel="Vetoing…"
                      className="border border-red-800 bg-red-900 px-4 py-2 text-sm font-semibold uppercase tracking-wide text-white transition hover:brightness-110"
                    >
                      Veto
                    </SubmitButton>
                  </form>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
