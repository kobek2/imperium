import Link from "next/link";
import { redirect } from "next/navigation";
import { getIsAdmin } from "@/lib/is-admin";
import { createElection } from "@/app/actions/elections";

export default async function NewElectionPage() {
  if (!(await getIsAdmin())) redirect("/");

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <Link href="/admin/elections" className="admin-textlink text-sm font-semibold text-[var(--psc-accent)]">
        ← Elections
      </Link>
      <h2 className="text-xl font-semibold">Create election</h2>
      <form action={createElection} className="grid gap-4 border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
        <label className="grid gap-1 text-sm font-semibold">
          Office
          <select name="office" required className="border border-[var(--psc-border)] bg-white px-3 py-2 font-normal">
            <option value="house">House</option>
            <option value="senate">Senate</option>
            <option value="president">President</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          State (2 letters, House/Senate only)
          <input
            name="state"
            maxLength={2}
            placeholder="CA"
            className="border border-[var(--psc-border)] bg-white px-3 py-2 font-mono uppercase font-normal"
          />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          District code (House only, e.g. CA-01)
          <input
            name="district_code"
            placeholder="CA-01"
            className="border border-[var(--psc-border)] bg-white px-3 py-2 font-mono font-normal"
          />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Senate class (1–3, Senate only)
          <select name="senate_class" className="border border-[var(--psc-border)] bg-white px-3 py-2 font-normal">
            <option value="">—</option>
            <option value="1">Class I</option>
            <option value="2">Class II</option>
            <option value="3">Class III</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Filing opens
          <input type="datetime-local" name="filing_opens_at" required className="border border-[var(--psc-border)] bg-white px-3 py-2 font-normal" />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Filing closes
          <input type="datetime-local" name="filing_closes_at" required className="border border-[var(--psc-border)] bg-white px-3 py-2 font-normal" />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Primary closes
          <input type="datetime-local" name="primary_closes_at" required className="border border-[var(--psc-border)] bg-white px-3 py-2 font-normal" />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          General closes
          <input type="datetime-local" name="general_closes_at" required className="border border-[var(--psc-border)] bg-white px-3 py-2 font-normal" />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Who may vote in the primary
          <select
            name="primary_ballot_scope"
            defaultValue="party_wide"
            className="border border-[var(--psc-border)] bg-white px-3 py-2 font-normal"
          >
            <option value="party_wide">
              Party-wide — same party may vote from any district/state (e.g. pick nominees elsewhere)
            </option>
            <option value="jurisdiction_only">
              Jurisdiction only — House/Senate seat residents on their Character record (candidates may
              still vote for themselves)
            </option>
          </select>
        </label>
        <p className="text-xs text-[var(--psc-muted)]">
          President races always use party-wide primaries regardless of this field.
        </p>
        <button
          type="submit"
          className="mt-2 border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-4 py-2 text-sm font-semibold uppercase tracking-wide text-white"
        >
          Create
        </button>
      </form>
    </div>
  );
}
