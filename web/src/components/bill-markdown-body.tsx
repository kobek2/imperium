import ReactMarkdown from "react-markdown";

/**
 * Renders bill markdown (filed legislation, nominations, etc.) for floor and desk views.
 */
export function BillMarkdownBody({ content }: { content: string }) {
  return (
    <div className="mt-4 rounded-lg border border-[var(--psc-border)] bg-[var(--psc-canvas)]/90 px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Full text</p>
      <div className="mt-2 max-h-[min(28rem,70vh)] overflow-y-auto pr-1">
        <ReactMarkdown
          components={{
            h2: ({ children }) => (
              <h2 className="mt-3 border-b border-[var(--psc-border)] pb-1 text-base font-semibold text-[var(--psc-ink)] first:mt-0">
                {children}
              </h2>
            ),
            h3: ({ children }) => (
              <h3 className="mt-3 text-sm font-semibold text-[var(--psc-ink)]">{children}</h3>
            ),
            p: ({ children }) => (
              <p className="mt-2 text-sm leading-relaxed text-[var(--psc-ink)] first:mt-0">{children}</p>
            ),
            ul: ({ children }) => <ul className="mt-2 list-disc pl-5 text-sm text-[var(--psc-ink)]">{children}</ul>,
            ol: ({ children }) => <ol className="mt-2 list-decimal pl-5 text-sm text-[var(--psc-ink)]">{children}</ol>,
            li: ({ children }) => <li className="mt-1">{children}</li>,
            strong: ({ children }) => <strong className="font-semibold text-[var(--psc-ink)]">{children}</strong>,
            em: ({ children }) => <em className="italic">{children}</em>,
            code: ({ children }) => (
              <code className="rounded bg-[var(--psc-panel)] px-1 py-0.5 font-mono text-xs text-[var(--psc-ink)]">
                {children}
              </code>
            ),
            hr: () => <hr className="my-4 border-[var(--psc-border)]" />,
            a: ({ href, children }) => (
              <a
                href={href}
                className="font-medium text-[var(--psc-accent)] underline underline-offset-2 hover:brightness-110"
                target="_blank"
                rel="noopener noreferrer"
              >
                {children}
              </a>
            ),
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
}
