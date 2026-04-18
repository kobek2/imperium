import Link from "next/link";
import { redirect } from "next/navigation";
import { getIsAdmin } from "@/lib/is-admin";
import { createElection } from "@/app/actions/elections";
import { CreateElectionForm } from "./create-election-form";

export default async function NewElectionPage() {
  if (!(await getIsAdmin())) redirect("/");

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <Link
        href="/admin/elections"
        className="admin-textlink text-sm font-semibold text-[var(--psc-accent)]"
      >
        ← Elections
      </Link>
      <div>
        <h2 className="text-xl font-semibold">Create election</h2>
        <p className="mt-1 text-sm text-[var(--psc-muted)]">
          Phases advance automatically based on the schedule below. Defaults are filing 24h, primary 24h,
          general 48h — edit the durations if you want a different cadence.
        </p>
      </div>
      <CreateElectionForm action={createElection} />
    </div>
  );
}
