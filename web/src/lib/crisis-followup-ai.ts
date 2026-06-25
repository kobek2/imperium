import { z } from "zod";

export type CrisisInstrument =
  | "executive_order"
  | "presidential_statement"
  | "letter_to_congress"
  | "bill_filed"
  | "bill_enacted";

export type CrisisFollowUpDraft = {
  title: string;
  summary: string;
  dateline: string;
  body: string;
};

export type CrisisFollowUpContext = {
  instrument: CrisisInstrument;
  intentTag: string | null;
  crisisTitle: string;
  crisisSummary: string;
  crisisBody: string;
  crisisDateline: string | null;
  crisisTopic: string;
  crisisCategory: string;
  documentTitle: string;
  documentBody: string;
};

const followUpSchema = z.object({
  title: z.string().min(12).max(300),
  summary: z.string().min(30).max(600),
  dateline: z.string().min(3).max(80),
  body: z.string().min(200).max(8000),
});

const INSTRUMENT_LABELS: Record<CrisisInstrument, string> = {
  executive_order: "executive order",
  presidential_statement: "presidential address to the nation",
  letter_to_congress: "letter from the president to Congress",
  bill_filed: "bill filed in Congress",
  bill_enacted: "bill enacted into law",
};

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeDocumentBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "";
  if (trimmed.includes("<") && trimmed.includes(">")) {
    return stripHtml(trimmed);
  }
  return trimmed;
}

export function buildGenericFollowUp(ctx: CrisisFollowUpContext): CrisisFollowUpDraft {
  const instrumentLabel = INSTRUMENT_LABELS[ctx.instrument];
  const place =
    ctx.crisisCategory === "international"
      ? "Geneva —"
      : ctx.crisisDateline?.split("—")[0]?.trim()
        ? `${ctx.crisisDateline.split("—")[0].trim()} —`
        : "Washington —";

  const actionLine =
    ctx.instrument === "bill_enacted"
      ? `Lawmakers and agency officials are moving to implement ${ctx.documentTitle}, enacted in response to ${ctx.crisisTitle.toLowerCase()}.`
      : ctx.instrument === "bill_filed"
        ? `Congress has taken up ${ctx.documentTitle}, filed as elected leaders respond to ${ctx.crisisTitle.toLowerCase()}.`
        : `The White House has issued a ${instrumentLabel} titled "${ctx.documentTitle}" in response to ${ctx.crisisTitle.toLowerCase()}.`;

  return {
    title: `Reaction builds after ${instrumentLabel} on ${ctx.crisisTopic} crisis`,
    summary: actionLine,
    dateline: place,
    body: `${actionLine}

Staff and agency officials are reviewing operational implications while congressional leaders schedule briefings and stake out public positions. Analysts say the government's next moves will shape whether the story fades from the front page or deepens into a protracted political fight.

> "What matters now is execution — the wire will be watching whether agencies and Congress can translate paper into results." — Senior administration official, speaking on background

Stakeholders across the affected region are monitoring implementation timelines, and opposition figures are preparing counter-messaging as the crisis enters a new phase on the wire.`,
  };
}

export async function generateCrisisFollowUpWithAi(
  ctx: CrisisFollowUpContext,
): Promise<CrisisFollowUpDraft | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;

  const instrumentLabel = INSTRUMENT_LABELS[ctx.instrument];
  const intentLine = ctx.intentTag ? `Declared focus: ${ctx.intentTag}.` : "";

  const system = `You are the Imperium simulation newsroom AI. Write the next wire beat for an ongoing crisis story.

Rules:
- React specifically to what the player wrote in their government document — quote policies, agencies, timelines, and tone from their text.
- Do NOT invent major facts that contradict the player's document.
- Match Imperium wire style: AP-style political journalism, neutral but vivid.
- Output valid JSON only with keys: title, summary, dateline, body.
- title: headline, max 120 chars.
- summary: one-sentence dek for the feed.
- dateline: city plus em dash, e.g. "Washington —" or "Long Beach —".
- body: 3–5 paragraphs separated by blank lines; include exactly one pull quote as a paragraph starting with "> " and attribution after an em dash, matching existing wire articles.
- Cover political reaction, implementation challenges, and what happens next — grounded in the player's response.`;

  const user = `CRISIS (beat 1 on the wire):
Title: ${ctx.crisisTitle}
Summary: ${ctx.crisisSummary}
Topic: ${ctx.crisisTopic} (${ctx.crisisCategory})
${ctx.crisisBody ? `Prior coverage excerpt:\n${ctx.crisisBody.slice(0, 2500)}` : ""}

PLAYER RESPONSE (${instrumentLabel}):
Title: ${ctx.documentTitle}
${intentLine}
Full text:
${ctx.documentBody.slice(0, 6000)}

Write beat 2: how the press, Congress, agencies, and public react to THIS specific response.`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_CRISIS_MODEL?.trim() || "gpt-4o-mini",
        temperature: 0.7,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });

    if (!res.ok) {
      console.warn("[generateCrisisFollowUpWithAi] OpenAI error", res.status, await res.text());
      return null;
    }

    const payload = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = payload.choices?.[0]?.message?.content;
    if (!raw) return null;

    const parsed = followUpSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      console.warn("[generateCrisisFollowUpWithAi] invalid JSON shape", parsed.error.message);
      return null;
    }

    return parsed.data;
  } catch (err) {
    console.warn("[generateCrisisFollowUpWithAi]", err);
    return null;
  }
}
