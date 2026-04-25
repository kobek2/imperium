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
