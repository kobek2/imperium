import type { SupabaseClient } from "@supabase/supabase-js";
import type { CampaignSpeechArchiveItem } from "@/components/campaign-speech-archive";

const REST_PAGE_SIZE = 1000;

export type CampaignSpeechRow = {
  id: string;
  candidate_id: string;
  author_id: string;
  content: string;
  target_state: string | null;
  points: number | null;
  created_at: string;
};

/** Paginate past PostgREST row caps so staff see every speech in a race. */
export async function fetchAllCampaignSpeechesForElection(
  supabase: SupabaseClient,
  election_id: string,
): Promise<CampaignSpeechRow[]> {
  const out: CampaignSpeechRow[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("campaign_speeches")
      .select("id, candidate_id, author_id, content, target_state, points, created_at")
      .eq("election_id", election_id)
      .order("created_at", { ascending: false })
      .range(from, from + REST_PAGE_SIZE - 1);
    if (error) throw error;
    const batch = (data ?? []) as CampaignSpeechRow[];
    out.push(...batch);
    if (batch.length < REST_PAGE_SIZE) break;
    from += REST_PAGE_SIZE;
  }
  return out;
}

export function toCampaignSpeechArchiveItems(
  speeches: CampaignSpeechRow[],
  lookup: {
    candidateName: (candidateId: string) => string;
    authorName: (authorId: string) => string;
  },
): CampaignSpeechArchiveItem[] {
  return speeches.map((s) => ({
    id: s.id,
    candidateId: s.candidate_id,
    authorId: s.author_id,
    content: s.content,
    targetState: s.target_state ? String(s.target_state).trim().toUpperCase() : null,
    points: s.points != null ? Number(s.points) : null,
    createdAt: s.created_at,
    candidateName: lookup.candidateName(s.candidate_id),
    authorName: lookup.authorName(s.author_id),
  }));
}
