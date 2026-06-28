"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { publishCrisisExecutiveOrder, publishCrisisStatement } from "@/app/actions/crisis-response";
import { BillRichTextEditorWithHiddenInput } from "@/components/bill-rich-text-editor";
import { FormSubmitButton } from "@/components/form-submit-button";
import { WireArticleBody } from "@/components/wire-article-body";
import type { CrisisBriefing } from "@/lib/simulation-events";
import { wireDeadlineLabel, wireScopeLabel, wireTopicLabel } from "@/lib/simulation-events";

const btn =
  "rounded border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white hover:brightness-110 disabled:opacity-50";

const intentOptions = [
  { value: "", label: "No tag (optional)" },
  { value: "domestic", label: "Domestic implementation" },
  { value: "diplomatic", label: "Diplomatic / foreign" },
  { value: "military", label: "Military / security" },
  { value: "economic", label: "Economic / sanctions" },
] as const;

function InstrumentSection({
  title,
  description,
  children,
  defaultOpen = false,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded border border-[var(--psc-border)] bg-white">
      <button
        type="button"
        className="flex w-full items-start justify-between gap-3 px-3 py-2.5 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <div>
          <p className="text-xs font-semibold text-[var(--psc-ink)]">{title}</p>
          <p className="mt-0.5 text-[11px] text-[var(--psc-muted)]">{description}</p>
        </div>
        <span className="shrink-0 text-[10px] font-semibold uppercase text-[var(--psc-accent)]">
          {open ? "Hide" : "Open"}
        </span>
      </button>
      {open ? <div className="border-t border-[var(--psc-border)] px-3 py-3">{children}</div> : null}
    </div>
  );
}

function PresidentInstruments({ briefing }: { briefing: CrisisBriefing }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const needsSig = !briefing.hasPresidentialSignature;

  const onSubmit = (action: (fd: FormData) => Promise<void>) => (formData: FormData) => {
    setMsg(null);
    start(async () => {
      try {
        await action(formData);
        setMsg("Published — the newsroom is drafting wire coverage based on your text.");
      } catch (e) {
        setMsg(e instanceof Error ? e.message : String(e));
      }
    });
  };

  return (
    <div className="space-y-3">
      {needsSig ? (
        <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          Save your presidential signature on the{" "}
          <Link href="/oval" className="font-semibold underline">
            Oval Office
          </Link>{" "}
          desk before issuing orders or statements.
        </p>
      ) : null}
      {msg ? (
        <p className="rounded border border-emerald-800/30 bg-emerald-50 px-3 py-2 text-xs text-emerald-950">
          {msg}
        </p>
      ) : null}

      <InstrumentSection
        title="Issue executive order"
        description="Write the full order — your text becomes the public record and moves the crisis."
        defaultOpen
      >
        <form action={onSubmit(publishCrisisExecutiveOrder)} className="space-y-3">
          <input type="hidden" name="story_arc_id" value={briefing.story_arc_id} />
          <label className="grid gap-1 text-xs font-semibold uppercase">
            Title
            <input
              name="title"
              required
              maxLength={300}
              disabled={pending || needsSig}
              placeholder="Executive Order on…"
              className="border border-[var(--psc-border)] bg-white px-2 py-2 text-sm normal-case"
            />
          </label>
          <div className="grid gap-1 text-xs font-semibold uppercase">
            Order text
            <BillRichTextEditorWithHiddenInput fieldName="body_html" />
          </div>
          <FormSubmitButton
            idleLabel="Publish executive order"
            pendingLabel="Publishing…"
            className={btn}
            disabled={pending || needsSig}
          />
        </form>
      </InstrumentSection>

      <InstrumentSection
        title="Address the nation"
        description="A public statement — rhetorical weight; pair with an order for maximum effect."
      >
        <form action={onSubmit(publishCrisisStatement)} className="space-y-3">
          <input type="hidden" name="story_arc_id" value={briefing.story_arc_id} />
          <input type="hidden" name="kind" value="address" />
          <label className="grid gap-1 text-xs font-semibold uppercase">
            Headline
            <input
              name="title"
              required
              maxLength={300}
              disabled={pending || needsSig}
              className="border border-[var(--psc-border)] bg-white px-2 py-2 text-sm normal-case"
            />
          </label>
          <label className="grid gap-1 text-xs font-semibold uppercase">
            Focus (optional)
            <select
              name="intent_tag"
              disabled={pending || needsSig}
              className="border border-[var(--psc-border)] bg-white px-2 py-2 text-sm normal-case"
              defaultValue=""
            >
              {intentOptions.map((o) => (
                <option key={o.value || "none"} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-1 text-xs font-semibold uppercase">
            Remarks
            <BillRichTextEditorWithHiddenInput fieldName="body_html" />
          </div>
          <FormSubmitButton
            idleLabel="Deliver address"
            pendingLabel="Publishing…"
            className={btn}
            disabled={pending || needsSig}
          />
        </form>
      </InstrumentSection>

      <InstrumentSection
        title="Letter to Congress"
        description="Request emergency legislation or authorize a congressional response."
      >
        <form action={onSubmit(publishCrisisStatement)} className="space-y-3">
          <input type="hidden" name="story_arc_id" value={briefing.story_arc_id} />
          <input type="hidden" name="kind" value="letter_to_congress" />
          <label className="grid gap-1 text-xs font-semibold uppercase">
            Subject
            <input
              name="title"
              required
              maxLength={300}
              disabled={pending || needsSig}
              className="border border-[var(--psc-border)] bg-white px-2 py-2 text-sm normal-case"
            />
          </label>
          <div className="grid gap-1 text-xs font-semibold uppercase">
            Letter
            <BillRichTextEditorWithHiddenInput fieldName="body_html" />
          </div>
          <FormSubmitButton
            idleLabel="Send to Congress"
            pendingLabel="Sending…"
            className={btn}
            disabled={pending || needsSig}
          />
        </form>
      </InstrumentSection>
    </div>
  );
}

function CongressInstruments({
  briefing,
  filingChamber,
}: {
  briefing: CrisisBriefing;
  filingChamber: "house" | "senate";
}) {
  const chamberPath = filingChamber === "senate" ? "/congress/senate" : "/congress/house";
  const href = `${chamberPath}?crisis_arc=${encodeURIComponent(briefing.story_arc_id)}`;

  return (
    <div className="space-y-3 rounded border border-[var(--psc-border)] bg-white p-3">
      <p className="text-xs text-[var(--psc-muted)]">
        File emergency legislation in your own words. When the bill is filed it links to this crisis; if it is
        signed into law the arc can resolve.
      </p>
      <Link
        href={href}
        className="inline-flex rounded border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white no-underline hover:brightness-110"
      >
        File crisis legislation
      </Link>
      <p className="text-[10px] text-[var(--psc-muted)]">
        Opens the {filingChamber === "senate" ? "Senate" : "House"} filing form with this crisis attached.
      </p>
    </div>
  );
}

export function CrisisBriefingPanel({
  briefings,
  filingChamber = "house",
}: {
  briefings: CrisisBriefing[];
  filingChamber?: "house" | "senate";
}) {
  if (!briefings.length) {
    return (
      <p className="text-sm text-[var(--psc-muted)]">
        No crisis action items assigned to you. Breaking stories spawn daily — when you are president or assigned
        to Congress, response tools appear here.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {briefings.map((b) => (
        <article
          key={b.story_arc_id}
          className="overflow-hidden rounded-lg border border-red-300/70 bg-white shadow-sm ring-1 ring-red-100"
        >
          <header className="border-b border-[var(--psc-border)] bg-red-50/60 px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-red-800">
                  Crisis briefing · {wireScopeLabel(b.category)} · {wireTopicLabel(b.topic)}
                </p>
                <h3 className="mt-1 text-base font-semibold text-[var(--psc-ink)]">{b.title}</h3>
                <p className="mt-1 text-[11px] text-[var(--psc-muted)]">
                  Your role: {b.assignment.role_label}
                  {b.assignment.is_primary ? " (lead)" : ""}
                  {b.responsesCount > 0 ? ` · ${b.responsesCount} government response(s) on record` : ""}
                </p>
              </div>
              <span className="rounded bg-red-600 px-2 py-0.5 text-[10px] font-bold uppercase text-white">
                {wireDeadlineLabel(b.deadline_at)}
              </span>
            </div>
          </header>
          <div className="px-4 py-3">
            <WireArticleBody summary={b.summary} dateline={b.dateline} body={b.body} publishedAt={b.opened_at} />
          </div>
          <div className="border-t border-[var(--psc-border)] bg-[var(--psc-canvas)]/50 px-4 py-4">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--psc-muted)]">
              Response instruments — write your own text
            </p>
            {b.isPresidentLead ? <PresidentInstruments briefing={b} /> : null}
            {b.isCongressAssignee && !b.isPresidentLead ? (
              <CongressInstruments briefing={b} filingChamber={filingChamber} />
            ) : null}
            {!b.isPresidentLead && !b.isCongressAssignee ? (
              <p className="text-xs text-[var(--psc-muted)]">
                You are on the crisis thread as {b.assignment.role_label}. Watch the wire for updates.
              </p>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}
