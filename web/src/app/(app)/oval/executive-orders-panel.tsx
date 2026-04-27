import Link from "next/link";
import { publishExecutiveOrder, savePresidentialSignature } from "@/app/actions/executive-orders";
import { SubmitButton } from "@/components/submit-button";

export function ExecutiveOrdersPanel({
  signature,
  recent,
}: {
  signature: string | null;
  recent: Array<{ id: string; title: string; created_at: string }>;
}) {
  const sig = (signature ?? "").trim();
  const hasSignature = sig.length >= 2;

  return (
    <section className="space-y-6 border border-[var(--psc-border)] bg-[var(--psc-panel)] p-6">
      <div>
        <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Executive orders</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--psc-muted)]">
          Set how you sign orders once, then publish text orders to the sim. Each release is delivered to every
          player&apos;s inbox and opens on a public record page.
        </p>
      </div>

      <div className="rounded-lg border border-[var(--psc-border)] bg-[var(--psc-canvas)]/60 p-5">
        <h3 className="text-sm font-semibold text-[var(--psc-ink)]">Presidential signature</h3>
        <p className="mt-1 text-xs text-[var(--psc-muted)]">
          This line is copied onto every order you issue (e.g. your character name as it should appear in ink).
        </p>
        <form action={savePresidentialSignature} className="mt-4 space-y-3">
          <textarea
            name="presidential_signature"
            rows={2}
            maxLength={500}
            defaultValue={sig}
            placeholder="e.g. Jordan A. Hayes"
            className="w-full max-w-lg rounded border border-[var(--psc-border)] bg-white px-3 py-2 text-sm text-[var(--psc-ink)]"
          />
          <div>
            <SubmitButton className="rounded border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white">
              Save signature
            </SubmitButton>
          </div>
        </form>
        {hasSignature ? (
          <p className="mt-3 text-xs font-medium text-emerald-800">Signature on file — you can publish orders.</p>
        ) : (
          <p className="mt-3 text-xs text-amber-900">Save a signature before publishing your first executive order.</p>
        )}
      </div>

      <div className="rounded-lg border border-[var(--psc-border)] bg-[var(--psc-canvas)]/60 p-5">
        <h3 className="text-sm font-semibold text-[var(--psc-ink)]">Publish order</h3>
        <form action={publishExecutiveOrder} className="mt-4 space-y-4">
          <label className="grid gap-1 text-sm font-semibold text-[var(--psc-ink)]">
            Title
            <input
              name="title"
              type="text"
              maxLength={300}
              required
              placeholder="Short headline"
              className="max-w-xl rounded border border-[var(--psc-border)] bg-white px-3 py-2 font-normal"
            />
          </label>
          <label className="grid gap-1 text-sm font-semibold text-[var(--psc-ink)]">
            Body
            <textarea
              name="body"
              rows={10}
              maxLength={8000}
              required
              placeholder="Full text of the order…"
              className="w-full max-w-2xl rounded border border-[var(--psc-border)] bg-white px-3 py-2 font-normal text-[var(--psc-ink)]"
            />
          </label>
          <SubmitButton
            disabled={!hasSignature}
            title={!hasSignature ? "Save your signature first" : undefined}
            className="rounded border border-emerald-900 bg-emerald-900 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Publish to inbox
          </SubmitButton>
        </form>
      </div>

      {recent.length > 0 ? (
        <div>
          <h3 className="text-sm font-semibold text-[var(--psc-ink)]">Your recent orders</h3>
          <ul className="mt-2 divide-y divide-[var(--psc-border)] rounded border border-[var(--psc-border)] bg-white">
            {recent.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2 text-sm">
                <Link href={`/oval/executive-orders/${r.id}`} className="font-semibold text-[var(--psc-accent)] hover:underline">
                  {r.title}
                </Link>
                <span className="text-xs text-[var(--psc-muted)]">{new Date(r.created_at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
