import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerAuth } from "@/lib/supabase/server";
import { BillBody } from "@/components/bill-body";

export default async function ExecutiveOrderPublicPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getServerAuth();
  if (!supabase) redirect("/");
  if (!user) redirect("/login");

  const { data: row, error } = await supabase
    .from("executive_orders")
    .select("id, title, body, signature_captured, created_at, issued_by")
    .eq("id", id)
    .maybeSingle();

  if (error || !row) notFound();

  const eo = row as {
    id: string;
    title: string;
    body: string;
    signature_captured: string;
    created_at: string;
    issued_by: string;
  };

  const { data: issuer } = await supabase
    .from("profiles")
    .select("character_name, discord_username")
    .eq("id", eo.issued_by)
    .maybeSingle();

  const issuerName =
    String(issuer?.character_name ?? "").trim() ||
    String(issuer?.discord_username ?? "").trim() ||
    "President";
  const bodyText = String(eo.body ?? "").trim();
  const looksLikeHtml = /<\/?[a-z][\s\S]*>/i.test(bodyText);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/oval" className="text-sm font-semibold text-[var(--psc-accent)] underline-offset-4 hover:underline">
        ← Executive desk
      </Link>

      <article className="rounded-lg border-2 border-[var(--psc-border)] bg-[var(--psc-panel)] p-8 shadow-sm">
        <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-[var(--psc-muted)]">Executive order</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-[var(--psc-ink)]">{eo.title}</h1>
        <p className="mt-2 text-xs text-[var(--psc-muted)]">
          Issued {new Date(eo.created_at).toLocaleString()} · {issuerName}
        </p>

        <div className="mt-8 border-t border-[var(--psc-border)] pt-8">
          <BillBody content_html={looksLikeHtml ? bodyText : null} content_md={looksLikeHtml ? null : bodyText} className="mt-0" />
        </div>

        <div className="mt-10 border-t border-dashed border-[var(--psc-border)] pt-8">
          <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-[var(--psc-muted)]">Signed</p>
          <p className="mt-3 font-serif text-2xl italic text-[var(--psc-ink)]">{eo.signature_captured}</p>
        </div>
      </article>
    </div>
  );
}
