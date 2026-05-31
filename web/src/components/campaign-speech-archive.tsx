import { countWords } from "@/lib/word-count";
import { DeleteCampaignSpeechButton } from "@/components/delete-campaign-speech-button";

export type CampaignSpeechArchiveItem = {
  id: string;
  candidateId: string;
  authorId: string;
  content: string;
  targetState: string | null;
  points: number | null;
  createdAt: string;
  candidateName: string;
  authorName: string;
};

export function CampaignSpeechArchive({
  speeches,
  title = "Campaign speech archive",
  adminDeleteElectionId = null,
}: {
  speeches: CampaignSpeechArchiveItem[];
  title?: string;
  adminDeleteElectionId?: string | null;
}) {
  if (!speeches.length) return null;

  return (
    <section className="space-y-3 border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
      <ArchiveHeader title={title} count={speeches.length} />
      <ul className="max-h-[48rem] space-y-3 overflow-y-auto pr-1">
        {speeches.map((speech) => {
          const words = countWords(speech.content);
          return (
            <li
              key={speech.id}
              className="relative space-y-1 rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)]/40 p-3 pr-11"
            >
              {adminDeleteElectionId ? (
                <SpeechDeleteCorner speechId={speech.id} electionId={adminDeleteElectionId} />
              ) : null}
              <p className="text-[11px] text-[var(--psc-muted)]">
                <span className="font-semibold text-[var(--psc-ink)]">{speech.authorName}</span>{" "}
                speaking for{" "}
                <span className="font-semibold text-[var(--psc-ink)]">{speech.candidateName}</span>
                {speech.targetState ? ` · ${speech.targetState}` : ""} ·{" "}
                {words} word{words === 1 ? "" : "s"}
                {speech.points != null ? ` · ${speech.points} pts` : ""} ·{" "}
                {new Date(speech.createdAt).toLocaleString()}
              </p>
              <p className="whitespace-pre-wrap text-sm text-[var(--psc-ink)]">{speech.content}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function SpeechDeleteCorner({ speechId, electionId }: { speechId: string; electionId: string }) {
  return (
    <div className="absolute right-2 top-2">
      <DeleteCampaignSpeechButton speechId={speechId} electionId={electionId} />
    </div>
  );
}

function ArchiveHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--psc-muted)]">{title}</h3>
      <span className="text-xs text-[var(--psc-muted)]">
        {count} speech{count === 1 ? "" : "es"}
      </span>
    </div>
  );
}
