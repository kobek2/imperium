export type WireArticleBlock =
  | { type: "paragraph"; text: string }
  | { type: "quote"; text: string; attribution?: string };

/** Split article body on blank lines; lines starting with `>` are pull quotes. */
export function parseWireArticleBody(body: string | null | undefined): WireArticleBlock[] {
  if (!body?.trim()) return [];

  return body
    .trim()
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      if (!chunk.startsWith(">")) {
        return { type: "paragraph" as const, text: chunk };
      }
      const raw = chunk.replace(/^>\s*/, "");
      const emDash = raw.match(/^(.+?)\s*[—–-]\s*(.+)$/);
      if (emDash) {
        return {
          type: "quote" as const,
          text: emDash[1]!.replace(/^["']|["']$/g, "").trim(),
          attribution: emDash[2]!.trim(),
        };
      }
      return { type: "quote" as const, text: raw.replace(/^["']|["']$/g, "").trim() };
    });
}

export function formatArticleDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function wireArticlePlainText(opts: {
  title: string;
  summary: string;
  dateline?: string | null;
  body?: string | null;
  publishedAt?: string;
}): string {
  const lines: string[] = [opts.title];
  if (opts.publishedAt) lines.push(formatArticleDate(opts.publishedAt));
  const lede = opts.dateline ? `${opts.dateline} ${opts.summary}` : opts.summary;
  if (lede) lines.push("", lede);
  if (opts.body?.trim()) {
    lines.push("");
    for (const block of parseWireArticleBody(opts.body)) {
      if (block.type === "quote") {
        const attr = block.attribution ? ` — ${block.attribution}` : "";
        lines.push(`"${block.text}"${attr}`);
      } else {
        lines.push(block.text);
      }
      lines.push("");
    }
  }
  return lines.join("\n").trim();
}
