"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  buildOrdinanceSummary,
  buildOrdinanceTitle,
  issueUsesStanceParams,
  ordinanceIssueByKey,
  type OrdinanceCategory,
  type OrdinanceIssueTemplate,
  type OrdinanceStanceKey,
} from "@/lib/city-ordinance-templates";
import {
  buildParametricOrdinanceSummary,
  buildParametricOrdinanceTitle,
  clampStanceParamsForIssue,
  issueUsesParametricScoring,
  type OrdinanceStanceParams,
} from "@/lib/city-ordinance-param-score";
import {
  fetchOrdinanceVotePreviewClient,
  type OrdinanceVotePreviewResult,
} from "@/lib/council-ordinance-preview";

export type CouncilLegislationResult = { ok: boolean; message: string };

function revalidateCouncilPaths() {
  revalidatePath("/council");
  revalidatePath("/mayor");
  revalidatePath("/directory");
}

export async function proposeCouncilOrdinance(
  input:
    | {
        category: OrdinanceCategory;
        issueKey: string;
        stanceKey: OrdinanceStanceKey;
      }
    | {
        category: OrdinanceCategory;
        issueKey: string;
        stanceParams: OrdinanceStanceParams;
      },
): Promise<CouncilLegislationResult> {
  const found = ordinanceIssueByKey(input.category, input.issueKey);
  if (!found) {
    return { ok: false, message: "Unknown ordinance template." };
  }

  const supabase = await createClient();
  let rpcPayload: Record<string, unknown>;

  if (issueUsesParametricScoring(input.issueKey)) {
    if (!("stanceParams" in input)) {
      return { ok: false, message: "Set bill parameters before proposing." };
    }
    const params = clampStanceParamsForIssue(input.issueKey, input.stanceParams);
    if (!params) {
      return { ok: false, message: "Invalid bill parameters." };
    }
    const title =
      buildParametricOrdinanceTitle(input.issueKey, params) ??
      buildOrdinanceTitle(input.category, input.issueKey, "moderate");
    const summary =
      buildParametricOrdinanceSummary(input.issueKey, params) ??
      buildOrdinanceSummary(input.category, input.issueKey, "moderate");
    rpcPayload = {
      p_category: input.category,
      p_issue_key: input.issueKey,
      p_stance_key: null,
      p_title: title,
      p_summary: summary,
      p_stance_params: params,
    };
  } else {
    if (!("stanceKey" in input)) {
      return { ok: false, message: "Pick a stance before proposing." };
    }
    const issue = found.issue as Extract<OrdinanceIssueTemplate, { stances: unknown }>;
    const stance = issue.stances.find((s) => s.key === input.stanceKey);
    if (!stance) {
      return { ok: false, message: "Pick a stance before proposing." };
    }
    const title = buildOrdinanceTitle(input.category, input.issueKey, input.stanceKey);
    const summary = buildOrdinanceSummary(input.category, input.issueKey, input.stanceKey);
    rpcPayload = {
      p_category: input.category,
      p_issue_key: input.issueKey,
      p_stance_key: input.stanceKey,
      p_title: title,
      p_summary: summary,
      p_stance_params: null,
    };
  }

  const { data, error } = await supabase.rpc("council_propose_ordinance", rpcPayload);

  if (error) return { ok: false, message: error.message };
  revalidateCouncilPaths();

  const title =
    issueUsesParametricScoring(input.issueKey) && "stanceParams" in input
      ? buildParametricOrdinanceTitle(
          input.issueKey,
          clampStanceParamsForIssue(input.issueKey, input.stanceParams)!,
        ) ?? "Ordinance"
      : "stanceKey" in input
        ? buildOrdinanceTitle(input.category, input.issueKey, input.stanceKey)
        : "Ordinance";

  const row = data as { passed?: boolean; yeas?: number; nays?: number; status?: string } | null;
  if (row?.passed === true) {
    return {
      ok: true,
      message: `Ordinance passed council ${row.yeas ?? 0}–${row.nays ?? 0}. Sent to the mayor for signature.`,
    };
  }
  if (row?.passed === false) {
    return {
      ok: true,
      message: `Ordinance failed council ${row?.yeas ?? 0}–${row?.nays ?? 0}.`,
    };
  }
  return {
    ok: true,
    message: `"${title}" filed for council vote. Other player-held seats must vote before NPC lines are applied.`,
  };
}

export async function councilOrdinanceVote(
  proposalId: string,
  vote: "yea" | "nay",
): Promise<CouncilLegislationResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("council_ordinance_vote", {
    p_proposal_id: proposalId,
    p_vote: vote,
  });
  if (error) return { ok: false, message: error.message };
  revalidateCouncilPaths();

  const row = data as {
    passed?: boolean;
    yeas?: number;
    nays?: number;
    pending?: boolean;
    player_votes?: number;
    required_votes?: number;
    vote_closes_at?: string;
  } | null;
  if (row?.pending) {
    const closesNote = row.vote_closes_at
      ? ` Vote closes ~${new Date(row.vote_closes_at).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })} unless all player seats vote first.`
      : "";
    return {
      ok: true,
      message: `Vote recorded (${row.player_votes ?? "?"}/${row.required_votes ?? "?"} player seats).${closesNote}`,
    };
  }
  if (row?.passed) {
    return {
      ok: true,
      message: `Ordinance passed council ${row.yeas ?? 0}–${row.nays ?? 0}. Sent to the mayor for signature.`,
    };
  }
  return { ok: true, message: `Ordinance failed ${row?.yeas ?? 0}–${row?.nays ?? 0}.` };
}

export type OrdinanceVotePreview = OrdinanceVotePreviewResult;

export async function fetchOrdinanceVotePreview(input: {
  category: string;
  issueKey: string;
  stanceKey?: string | null;
  stanceParams?: OrdinanceStanceParams | null;
  issueEconomicScore?: number;
  issueSocialScore?: number;
}): Promise<OrdinanceVotePreview | null> {
  return fetchOrdinanceVotePreviewClient(input);
}

export { issueUsesStanceParams };
