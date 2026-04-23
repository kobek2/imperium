import { sanitizeBillHtml } from "@/lib/sanitize-bill-html";
import { BillMarkdownBody } from "@/components/bill-markdown-body";

/**
 * Renders bill text: prefers stored HTML (rich text), else legacy markdown.
 */
export function BillBody({
  content_html,
  content_md,
  className = "",
}: {
  content_html?: string | null;
  content_md?: string | null;
  className?: string;
}) {
  const rawHtml = content_html?.trim();
  if (rawHtml) {
    const safe = sanitizeBillHtml(rawHtml);
    return (
      <div
        className={`bill-body-richtext mt-4 rounded-lg border border-[var(--psc-border)] bg-[var(--psc-canvas)]/90 px-4 py-3 text-sm leading-relaxed text-[var(--psc-ink)] [&_code]:rounded [&_code]:bg-[color-mix(in_srgb,var(--psc-ink)_6%,transparent)] [&_code]:px-1 [&_code]:text-xs [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:border-b [&_h2]:border-[var(--psc-border)] [&_h2]:pb-1 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:mt-3 [&_h3]:text-sm [&_h3]:font-semibold [&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:mb-3 [&_table]:mt-2 [&_table]:w-full [&_table]:border-collapse [&_table]:text-sm [&_td]:border [&_td]:border-[var(--psc-border)] [&_td]:px-2 [&_td]:py-1.5 [&_td]:align-top [&_th]:border [&_th]:border-[var(--psc-border)] [&_th]:bg-[color-mix(in_srgb,var(--psc-ink)_4%,transparent)] [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:text-xs [&_th]:font-semibold [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 ${className}`}
      >
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Full text</p>
        <div
          className="mt-2 max-h-[min(32rem,75vh)] overflow-y-auto pr-1"
          dangerouslySetInnerHTML={{ __html: safe }}
        />
      </div>
    );
  }
  if (content_md?.trim()) {
    return <BillMarkdownBody content={content_md} />;
  }
  return (
    <p className={`mt-4 text-sm italic text-[var(--psc-muted)] ${className}`}>No bill text on file.</p>
  );
}
