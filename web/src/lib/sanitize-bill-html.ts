import sanitizeHtml from "sanitize-html";

export function escapeHtmlPlain(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Legacy markdown body → simple HTML for the rich editor initial value. */
export function legacyMdToEditorHtml(md: string | null | undefined): string | null {
  const t = md?.trim();
  if (!t) return null;
  return `<pre class="whitespace-pre-wrap font-sans text-sm">${escapeHtmlPlain(t)}</pre>`;
}

/** Strips tags for duplicate detection and legacy `content_md` storage. */
export function htmlToPlainText(html: string): string {
  const t = sanitizeHtml(html, {
    allowedTags: [],
    allowedAttributes: {},
  });
  return t.replace(/\s+/g, " ").trim();
}

/**
 * Converts editor HTML into plain text while preserving meaningful line breaks between
 * blocks/lists. Useful for amendment snapshots where we need human-readable fallback text.
 */
export function htmlToPlainTextPreserveBreaks(html: string): string {
  const blockBreaks = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|h2|h3|h4|li|blockquote|pre|tr|div)\s*>/gi, "\n")
    .replace(/<\/\s*(ul|ol|table|thead|tbody)\s*>/gi, "\n\n");
  const t = sanitizeHtml(blockBreaks, {
    allowedTags: [],
    allowedAttributes: {},
  });
  return t
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Sanitize rich text from the bill editor before persisting or rendering. */
export function sanitizeBillHtml(dirty: string): string {
  return sanitizeHtml(dirty, {
    allowedTags: [
      "h2",
      "h3",
      "h4",
      "p",
      "br",
      "strong",
      "b",
      "em",
      "i",
      "u",
      "ul",
      "ol",
      "li",
      "blockquote",
      "pre",
      "code",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
    ],
    allowedAttributes: {
      pre: ["class"],
      p: ["style", "class"],
      h2: ["style", "class"],
      h3: ["style", "class"],
      h4: ["style", "class"],
      li: ["class"],
      ol: ["class", "start"],
      ul: ["class"],
      blockquote: ["class"],
    },
    allowedStyles: {
      "*": {
        "text-align": [/^left$/i, /^right$/i, /^center$/i, /^justify$/i],
      },
    },
    allowedClasses: {
      pre: ["*"],
    },
  });
}
