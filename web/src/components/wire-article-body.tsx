import { formatArticleDate, parseWireArticleBody } from "@/lib/wire-article-format";

export function WireArticleBody({
  summary,
  dateline,
  body,
  publishedAt,
  compact = false,
}: {
  summary: string;
  dateline?: string | null;
  body?: string | null;
  publishedAt?: string;
  /** Ticker cards: show dek only */
  compact?: boolean;
}) {
  const blocks = parseWireArticleBody(body);
  const hasBody = blocks.length > 0;

  return (
    <div className={compact ? "space-y-2" : "space-y-4"}>
      {publishedAt ? (
        <p className="text-[11px] font-medium text-[var(--psc-muted)]">{formatArticleDate(publishedAt)}</p>
      ) : null}
      <p
        className={`leading-relaxed text-[var(--psc-ink)] ${
          compact ? "text-xs text-[var(--psc-muted)]" : "text-sm font-medium"
        }`}
      >
        {dateline ? (
          <>
            <span className="font-semibold">{dateline}</span> {summary}
          </>
        ) : (
          summary
        )}
      </p>
      {!compact && hasBody ? (
        <div className="space-y-3 border-t border-[var(--psc-border)] pt-3">
          {blocks.map((block, i) =>
            block.type === "quote" ? (
              <blockquote
                key={i}
                className="border-l-2 border-red-700/60 bg-red-50/30 py-2 pl-4 pr-2 text-sm italic leading-relaxed text-[var(--psc-ink)]"
              >
                &ldquo;{block.text}&rdquo;
                {block.attribution ? (
                  <footer className="mt-1.5 text-xs font-semibold not-italic text-[var(--psc-muted)]">
                    — {block.attribution}
                  </footer>
                ) : null}
              </blockquote>
            ) : (
              <p key={i} className="text-sm leading-relaxed text-[var(--psc-ink)]">
                {block.text}
              </p>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}
