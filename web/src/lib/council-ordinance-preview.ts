import { createClient } from "@/lib/supabase/client";
import {
  clampStanceParamsForIssue,
  deriveCoalitionKeyForParametricIssue,
  issueUsesParametricScoring,
  scoreOrdinanceByIssue,
  type OrdinanceStanceParams,
} from "@/lib/city-ordinance-param-score";

export type OrdinanceVotePreviewRow = {
  wardCode: string;
  voterLabel: string;
  party: string;
  vote: "yea" | "nay";
};

export type OrdinanceVotePreviewResult = {
  yeas: number;
  nays: number;
  passes: boolean;
  rollCall: OrdinanceVotePreviewRow[];
  issueEconomicScore: number;
  issueSocialScore: number;
};

export function resolveOrdinancePreviewScores(input: {
  issueKey: string;
  stanceParams?: OrdinanceStanceParams | null;
  issueEconomicScore?: number;
  issueSocialScore?: number;
}): { economic: number; social: number } | null {
  if (input.issueEconomicScore != null && input.issueSocialScore != null) {
    return { economic: input.issueEconomicScore, social: input.issueSocialScore };
  }
  if (issueUsesParametricScoring(input.issueKey) && input.stanceParams) {
    const clamped = clampStanceParamsForIssue(input.issueKey, input.stanceParams);
    if (!clamped) return null;
    const s = scoreOrdinanceByIssue(input.issueKey, clamped);
    if (!s) return null;
    return { economic: s.issue_economic_score, social: s.issue_social_score };
  }
  return null;
}

export async function fetchOrdinanceVotePreviewClient(input: {
  category: string;
  issueKey: string;
  stanceKey?: string | null;
  stanceParams?: OrdinanceStanceParams | null;
  issueEconomicScore?: number;
  issueSocialScore?: number;
}): Promise<OrdinanceVotePreviewResult | null> {
  const scores = resolveOrdinancePreviewScores(input);
  if (!scores && !input.stanceKey) return null;

  const clampedParams =
    input.stanceParams && issueUsesParametricScoring(input.issueKey)
      ? clampStanceParamsForIssue(input.issueKey, input.stanceParams)
      : null;

  const coalitionKey =
    input.stanceKey ??
    (scores ? deriveCoalitionKeyForParametricIssue(input.issueKey, scores.economic) : null);

  const supabase = createClient();
  const { data, error } = await supabase.rpc("preview_ordinance_council_vote", {
    p_category: input.category,
    p_issue_key: input.issueKey,
    p_stance_key: coalitionKey,
    p_issue_economic: scores?.economic ?? null,
    p_issue_social: scores?.social ?? null,
    p_stance_params: clampedParams,
  });

  if (error) {
    console.warn("[council-ordinance-preview]", error.message);
    return null;
  }

  const row = data as {
    yeas?: number;
    nays?: number;
    passes?: boolean;
    issue_economic_score?: number;
    issue_social_score?: number;
    roll_call?: { ward_code: string; voter_label: string; party: string; vote: string }[];
  } | null;
  if (!row) return null;

  return {
    yeas: row.yeas ?? 0,
    nays: row.nays ?? 0,
    passes: Boolean(row.passes),
    issueEconomicScore: row.issue_economic_score ?? scores?.economic ?? 0,
    issueSocialScore: row.issue_social_score ?? scores?.social ?? 0,
    rollCall: (row.roll_call ?? []).map((r) => ({
      wardCode: r.ward_code,
      voterLabel: r.voter_label,
      party: r.party,
      vote: r.vote === "yea" ? "yea" : "nay",
    })),
  };
}

export function ordinancePreviewInputKey(input: {
  category: string;
  issueKey: string;
  stanceKey?: string | null;
  stanceParams?: OrdinanceStanceParams | null;
  issueEconomicScore?: number;
  issueSocialScore?: number;
}): string {
  const scores = resolveOrdinancePreviewScores(input);
  if (scores) {
    return `${input.category}:${input.issueKey}:${scores.economic}:${scores.social}`;
  }
  return `${input.category}:${input.issueKey}:${input.stanceKey ?? ""}`;
}
