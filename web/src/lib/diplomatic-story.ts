/**
 * Story-mode bilateral dialogue: each host-country beat encodes their priorities;
 * Secretary responses are scored as aligned / neutral / tension relative to those priorities.
 */

export type StanceVsPriorities = "aligned" | "neutral" | "tension";

export type DiplomaticStoryResponse = {
  id: string;
  /** Line the U.S. Secretary says (first person or institutional voice). */
  line: string;
  /** How the host capital reads this against their stated priorities. */
  stanceVsPriorities: StanceVsPriorities;
};

export type DiplomaticStoryBeat = {
  id: string;
  /** What the counterpart lead says in-scene. */
  npcMessage: string;
  responses: [DiplomaticStoryResponse, DiplomaticStoryResponse, DiplomaticStoryResponse];
};

export type DiplomaticStoryScript = {
  scriptVersion: 2;
  nationCode: string;
  nationDisplayName: string;
  leaderName: string;
  leaderTitle: string;
  portraitUrl: string | null;
  /** Short RP caption of what this government cares about right now (drives alignment scoring). */
  hostPrioritiesBlurb: string;
  openingNpcMessage: string;
  beats: [DiplomaticStoryBeat, DiplomaticStoryBeat, DiplomaticStoryBeat];
};

function hashToUnit(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 2 ** 32;
}

/** Same-origin placeholder art for host negotiators (six palette variants, stable per ISO code). */
export function diplomatPlaceholderPortraitUrl(nationCode: string): string {
  const u = hashToUnit(`${nationCode.trim().toUpperCase()}:diplomat-portrait`);
  const idx = Math.floor(u * 6) + 1;
  return `/diplomat-placeholders/host-${idx}.svg`;
}

function pickVariant<T>(variants: readonly T[], seed: string, key: string): T {
  const ix = Math.floor(hashToUnit(`${seed}:${key}`) * variants.length) % variants.length;
  return variants[ix]!;
}

function genericScript(code: string, displayName: string, seed: string): DiplomaticStoryScript {
  const vOpen = pickVariant(
    [
      `${displayName} arrives punctually. Their lead negotiator opens with stability and sovereignty — economic growth first, security second, and a demand that any agenda respect their domestic narrative.`,
      `The delegation frames ${displayName} as a partner when treated with parity: trade that is reciprocal, security language that is precise, and no surprises in the press before the meeting.`,
    ] as const,
    seed,
    "open",
  );

  const mkBeat = (i: number, topic: string, a: DiplomaticStoryResponse, b: DiplomaticStoryResponse, c: DiplomaticStoryResponse): DiplomaticStoryBeat => ({
    id: `g-${i}`,
    npcMessage: topic,
    responses: [a, b, c],
  });

  return {
    scriptVersion: 2,
    nationCode: code,
    nationDisplayName: displayName,
    leaderName: "Chief negotiator",
    leaderTitle: `${displayName} — foreign ministry`,
    portraitUrl: diplomatPlaceholderPortraitUrl(code),
    hostPrioritiesBlurb: `Economic stability, sovereign equality, and predictable follow-through on anything agreed in this room.`,
    openingNpcMessage: vOpen,
    beats: [
      mkBeat(
        0,
        `They lean forward. "Concrete deliverables matter more than symbolism. Where can we expand mutual benefit without crossing our red lines?"`,
        {
          id: "g0a",
          line: "Offer a narrow pilot on customs pre-clearance with published metrics and a 90-day review.",
          stanceVsPriorities: "aligned",
        },
        {
          id: "g0b",
          line: "Pivot to values language and ask for civil-society access guarantees up front.",
          stanceVsPriorities: "tension",
        },
        {
          id: "g0c",
          line: "Propose a joint technocratic workshop with no media until a readout exists.",
          stanceVsPriorities: "neutral",
        },
      ),
      mkBeat(
        1,
        `"Security is inseparable from economics for us," they continue. "How does Washington intend to signal restraint while allies still rearm?"`,
        {
          id: "g1a",
          line: "Acknowledge their framing and propose transparent notification windows for exercises near busy sea lanes.",
          stanceVsPriorities: "aligned",
        },
        {
          id: "g1b",
          line: "State that alliances are defensive by treaty text and not a topic for concession today.",
          stanceVsPriorities: "tension",
        },
        {
          id: "g1c",
          line: "Table a hotline test between coast guards for SAR coordination as a confidence step.",
          stanceVsPriorities: "neutral",
        },
      ),
      mkBeat(
        2,
        `"We will take outcomes home to our public," they say quietly. "What can you commit before we walk out?"`,
        {
          id: "g2a",
          line: "Offer a signed aide-mémoire on two narrow items with dates and responsible agencies named.",
          stanceVsPriorities: "aligned",
        },
        {
          id: "g2b",
          line: "Refuse written commitments and keep everything verbal to avoid domestic blowback.",
          stanceVsPriorities: "tension",
        },
        {
          id: "g2c",
          line: "Promise a principals-only readout within 72 hours and a follow-on technical call.",
          stanceVsPriorities: "neutral",
        },
      ),
    ],
  };
}

const SCRIPTS: Partial<
  Record<string, Omit<DiplomaticStoryScript, "scriptVersion" | "nationCode" | "portraitUrl">>
> = {
  CHN: {
    nationDisplayName: "China",
    leaderName: "Lead negotiator",
    leaderTitle: "People’s Republic of China — foreign ministry",
    hostPrioritiesBlurb:
      "Economic modernization and stable growth; sovereignty and territorial integrity; multipolarity with parity at the table.",
    openingNpcMessage:
      "They greet you with careful courtesy. \"Our civilization’s modernization is the center of our policy — development first. We seek cooperation where interests overlap, but we will not treat core concerns as bargaining chips. The United States should speak with clarity: trade must be reciprocal, not punitive; security rhetoric should not drift toward containment.\"",
    beats: [
      {
        id: "chn-0",
        npcMessage:
          "\"Supply chains are political,\" they say evenly. \"How does your side propose to de-risk without decoupling in ways that look like strangulation?\"",
        responses: [
          {
            id: "chn-0a",
            line: "Propose a joint task force on critical inputs with transparent quotas and dispute arbitration both sides accept.",
            stanceVsPriorities: "aligned",
          },
          {
            id: "chn-0b",
            line: "Insist that export controls on advanced semiconductors are non-negotiable national security policy.",
            stanceVsPriorities: "tension",
          },
          {
            id: "chn-0c",
            line: "Ask for a confidential data exchange on bottlenecks before any public announcement.",
            stanceVsPriorities: "neutral",
          },
        ],
      },
      {
        id: "chn-1",
        npcMessage:
          "\"The Taiwan question is not abstract history for us,\" they continue. \"Signals from Washington travel fast. What restraint can you describe in concrete terms?\"",
        responses: [
          {
            id: "chn-1a",
            line: "Reaffirm the longstanding U.S. approach and offer clearer crisis-communication channels to prevent miscalculation.",
            stanceVsPriorities: "aligned",
          },
          {
            id: "chn-1b",
            line: "State that U.S. partnerships in the region will continue to deepen regardless of this meeting.",
            stanceVsPriorities: "tension",
          },
          {
            id: "chn-1c",
            line: "Shift to confidence-building: civilian maritime traffic coordination and weather-data sharing.",
            stanceVsPriorities: "neutral",
          },
        ],
      },
      {
        id: "chn-2",
        npcMessage:
          "\"We can leave with something modest,\" they say, folding their hands, \"or nothing at all. What are you prepared to write down?\"",
        responses: [
          {
            id: "chn-2a",
            line: "Offer a short joint statement on two economic measures with named agencies and timelines.",
            stanceVsPriorities: "aligned",
          },
          {
            id: "chn-2b",
            line: "Decline written outcomes and keep the session as a listening tour only.",
            stanceVsPriorities: "tension",
          },
          {
            id: "chn-2c",
            line: "Propose a follow-on meeting for technical experts before any public messaging.",
            stanceVsPriorities: "neutral",
          },
        ],
      },
    ],
  },
  GBR: {
    nationDisplayName: "United Kingdom",
    leaderName: "Lead negotiator",
    leaderTitle: "United Kingdom — Foreign, Commonwealth & Development Office",
    hostPrioritiesBlurb:
      "NATO solidarity, Ukraine support, climate and clean energy partnerships, and a stable U.S.–UK economic corridor post-Brexit.",
    openingNpcMessage:
      "\"Good to see you in person,\" they begin warmly. \"We want the special relationship to feel operational — Ukraine, NATO burden-sharing, and green industry. Our publics are fatigued by drift; they reward small, credible wins more than sweeping rhetoric.\"",
    beats: [
      {
        id: "gbr-0",
        npcMessage:
          "\"On Ukraine: we need predictable industrial capacity coordination. How do you square congressional politics with timelines our factories can plan around?\"",
        responses: [
          {
            id: "gbr-0a",
            line: "Commit to a classified planning channel on production targets with quarterly readouts to ministers.",
            stanceVsPriorities: "aligned",
          },
          {
            id: "gbr-0b",
            line: "Suggest Ukraine funding is uncertain and they should diversify suppliers away from U.S. assumptions.",
            stanceVsPriorities: "tension",
          },
          {
            id: "gbr-0c",
            line: "Offer a joint op-ed framework only — no new commitments until Capitol Hill acts.",
            stanceVsPriorities: "neutral",
          },
        ],
      },
      {
        id: "gbr-1",
        npcMessage:
          "\"Climate isn’t a side dish for us,\" they add. \"Grid interconnectors and offshore wind are industrial strategy. Where can we move money together without tripping subsidy rules?\"",
        responses: [
          {
            id: "gbr-1a",
            line: "Float a bilateral task force on clean steel and shared standards with WTO-compatible guardrails.",
            stanceVsPriorities: "aligned",
          },
          {
            id: "gbr-1b",
            line: "Argue that domestic content requirements in the U.S. will always trump joint projects.",
            stanceVsPriorities: "tension",
          },
          {
            id: "gbr-1c",
            line: "Invite Treasury and BEIS teams to model one pilot corridor before leaders announce anything.",
            stanceVsPriorities: "neutral",
          },
        ],
      },
      {
        id: "gbr-2",
        npcMessage:
          "\"Last question — Northern Ireland protocol politics still echo in Westminster. Can Washington speak carefully when microphones are hot?\"",
        responses: [
          {
            id: "gbr-2a",
            line: "Acknowledge sensitivity and promise coordinated messaging with their comms shop before any press.",
            stanceVsPriorities: "aligned",
          },
          {
            id: "gbr-2b",
            line: "Treat it as an internal UK matter and decline to constrain U.S. officials’ public commentary.",
            stanceVsPriorities: "tension",
          },
          {
            id: "gbr-2c",
            line: "Offer a bland, agreed talking point for any stray questions this week.",
            stanceVsPriorities: "neutral",
          },
        ],
      },
    ],
  },
};

export function buildStoryScript(nationCode: string, nationDisplayName: string, seed: string): DiplomaticStoryScript {
  const code = nationCode.trim().toUpperCase();
  const preset = SCRIPTS[code];
  if (preset) {
    return {
      scriptVersion: 2,
      nationCode: code,
      ...preset,
      portraitUrl: diplomatPlaceholderPortraitUrl(code),
    };
  }
  return genericScript(code, nationDisplayName, seed);
}

/** Stored `rp_diplomatic_sessions.agenda` JSON for story-mode intensive sessions. */
export function isStorySessionAgenda(agenda: unknown): agenda is DiplomaticStoryScript {
  if (!agenda || typeof agenda !== "object") return false;
  const s = agenda as Partial<DiplomaticStoryScript>;
  return s.scriptVersion === 2 && typeof s.nationCode === "string" && Array.isArray(s.beats) && s.beats.length === 3;
}

export function validateStoryChoices(script: DiplomaticStoryScript, choicePath: number[]): boolean {
  if (choicePath.length !== script.beats.length) return false;
  for (let i = 0; i < script.beats.length; i += 1) {
    const c = choicePath[i];
    if (typeof c !== "number" || !Number.isInteger(c) || c < 0 || c > 2) return false;
  }
  return true;
}

/** Map each stance to a numeric weight for the host government’s reception. */
function stanceWeight(s: StanceVsPriorities): number {
  if (s === "aligned") return 1;
  if (s === "neutral") return 0;
  return -1;
}

/**
 * Final relationship change (0–100 scale) from alignment across three beats only.
 * - Each beat: aligned +1, neutral 0, tension −1 on an internal axis; scaled by `stanceScale`.
 * - `sessionBaseline` rewards completing the intensive track (8h) regardless of tone.
 */
export function computeStoryRelationDelta(
  script: DiplomaticStoryScript,
  choicePath: number[],
): { delta: number; alignmentAxis: number } {
  if (!validateStoryChoices(script, choicePath)) {
    return { delta: 0, alignmentAxis: 0 };
  }
  let axis = 0;
  for (let i = 0; i < script.beats.length; i += 1) {
    const opt = script.beats[i]!.responses[choicePath[i]!];
    if (!opt) return { delta: 0, alignmentAxis: 0 };
    axis += stanceWeight(opt.stanceVsPriorities);
  }
  const stanceScale = 7;
  const sessionBaseline = 10;
  const delta = sessionBaseline + axis * stanceScale;
  return { delta: Math.round(Math.min(28, Math.max(-18, delta))), alignmentAxis: axis };
}
