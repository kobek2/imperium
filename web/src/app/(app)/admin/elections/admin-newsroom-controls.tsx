"use client";

import { useMemo, useState } from "react";
import { FormSubmitButton } from "@/components/form-submit-button";
import { adminPublishWireArticle, adminRunWireEventsTick } from "@/app/actions/simulation-events";
import type { NewsPoolTemplate, StoryContinueTarget } from "@/lib/simulation-events";
import { wireScopeLabel, wireTopicLabel } from "@/lib/simulation-events";

const btn =
  "rounded border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white hover:brightness-110";

function groupPool(templates: NewsPoolTemplate[]) {
  const starters = templates.filter((t) => t.is_starter);
  const followUps = templates.filter((t) => !t.is_starter);
  const byScope = {
    domestic: starters.filter((t) => t.category === "domestic"),
    international: starters.filter((t) => t.category === "international"),
  };
  return { starters, followUps, byScope };
}

export function AdminNewsroomControls({
  pool,
  continueTargets,
}: {
  pool: NewsPoolTemplate[];
  continueTargets: StoryContinueTarget[];
}) {
  const { followUps, byScope } = useMemo(() => groupPool(pool), [pool]);
  const [parentId, setParentId] = useState(continueTargets[0]?.instance_id ?? "");

  const parent = continueTargets.find((t) => t.instance_id === parentId) ?? null;
  const matchingFollowUps = parent
    ? followUps.filter(
        (t) => !t.follow_up_of_template_key || t.follow_up_of_template_key === parent.template_key,
      )
    : followUps;

  return (
    <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-[var(--psc-ink)]">Newsroom</h3>
      <p className="mt-1 text-[11px] text-[var(--psc-muted)]">
        Publish breaking stories from the pool or write custom copy. Continue an existing arc to develop a
        storyline over multiple articles.
      </p>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <form action={adminPublishWireArticle} className="space-y-3 rounded border border-[var(--psc-border)] p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-red-700">
            New breaking story
          </p>
          <input type="hidden" name="mode" value="new" />
          <label className="grid gap-1 text-xs font-semibold uppercase">
            Story pool
            <select
              name="template_key"
              required
              disabled={!pool.length}
              className="border border-[var(--psc-border)] bg-white px-2 py-2 text-sm normal-case disabled:opacity-50"
              defaultValue={pool.find((t) => t.is_starter)?.template_key ?? ""}
            >
              {!pool.length ? <option value="">Run newsroom migration first</option> : null}
              {byScope.domestic.length ? (
                <optgroup label="United States">
                  {byScope.domestic.map((t) => (
                    <option key={t.template_key} value={t.template_key}>
                      [{wireTopicLabel(t.topic)}] {t.title}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {byScope.international.length ? (
                <optgroup label="World">
                  {byScope.international.map((t) => (
                    <option key={t.template_key} value={t.template_key}>
                      [{wireTopicLabel(t.topic)}] {t.title}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
          </label>
          <FormSubmitButton
            idleLabel="Publish breaking"
            pendingLabel="Publishing…"
            className={btn}
            disabled={!pool.some((t) => t.is_starter)}
          />
        </form>

        <form action={adminPublishWireArticle} className="space-y-3 rounded border border-[var(--psc-border)] p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-800">
            Continue story arc
          </p>
          <input type="hidden" name="mode" value="continue" />
          <label className="grid gap-1 text-xs font-semibold uppercase">
            Continue from
            <select
              name="parent_instance_id"
              required
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              className="border border-[var(--psc-border)] bg-white px-2 py-2 text-sm normal-case"
            >
              {continueTargets.length ? (
                continueTargets.map((t) => (
                  <option key={t.instance_id} value={t.instance_id}>
                    Beat {t.beat_number}: {t.title.slice(0, 72)}
                    {t.title.length > 72 ? "…" : ""}
                  </option>
                ))
              ) : (
                <option value="">No stories yet — publish a breaking story first</option>
              )}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-semibold uppercase">
            Pool follow-up
            <select
              name="template_key"
              required
              disabled={!continueTargets.length}
              className="border border-[var(--psc-border)] bg-white px-2 py-2 text-sm normal-case disabled:opacity-50"
              defaultValue={matchingFollowUps[0]?.template_key ?? ""}
              key={parentId}
            >
              {matchingFollowUps.length ? (
                matchingFollowUps.map((t) => (
                  <option key={t.template_key} value={t.template_key}>
                    {t.title}
                  </option>
                ))
              ) : (
                <option value="">No scripted follow-ups for this arc</option>
              )}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-semibold uppercase">
            Beat type
            <select name="beat_label" className="w-full border border-[var(--psc-border)] bg-white px-2 py-2 text-sm normal-case">
              <option value="developing">Developing</option>
              <option value="update">Update</option>
              <option value="escalation">Escalation</option>
              <option value="analysis">Analysis</option>
            </select>
          </label>
          <FormSubmitButton
            idleLabel="Publish follow-up"
            pendingLabel="Publishing…"
            className={btn}
            disabled={!continueTargets.length || !matchingFollowUps.length}
          />
          {!matchingFollowUps.length && continueTargets.length > 0 ? (
            <p className="text-[10px] text-[var(--psc-muted)] normal-case">
              No scripted follow-up for this arc — use Custom bulletin with &quot;Continue arc&quot; below.
            </p>
          ) : null}
        </form>
      </div>

      <form action={adminPublishWireArticle} className="mt-4 space-y-3 rounded border border-[var(--psc-border)] p-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--psc-muted)]">
          Custom bulletin
        </p>
        <input type="hidden" name="mode" value="custom" />
        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-1 text-xs font-semibold uppercase">
            Headline
            <input
              name="title"
              required
              maxLength={120}
              placeholder="Markets react as crisis deepens"
              className="border border-[var(--psc-border)] bg-white px-2 py-2 text-sm normal-case"
            />
          </label>
          <label className="grid gap-1 text-xs font-semibold uppercase">
            Window (hours)
            <input
              name="hours"
              type="number"
              min={4}
              max={72}
              defaultValue={24}
              className="w-24 border border-[var(--psc-border)] bg-white px-2 py-2 font-mono text-sm normal-case"
            />
          </label>
        </div>
        <label className="grid gap-1 text-xs font-semibold uppercase">
          Lede
          <textarea
            name="summary"
            required
            rows={2}
            maxLength={500}
            placeholder="Opening sentences — what happened and why it matters."
            className="border border-[var(--psc-border)] bg-white px-2 py-2 text-sm normal-case"
          />
        </label>
        <label className="grid gap-1 text-xs font-semibold uppercase">
          Dateline (optional)
          <input
            name="dateline"
            maxLength={40}
            placeholder="Washington —"
            className="w-48 border border-[var(--psc-border)] bg-white px-2 py-2 text-sm normal-case"
          />
        </label>
        <label className="grid gap-1 text-xs font-semibold uppercase">
          Full article (optional)
          <textarea
            name="body"
            rows={8}
            maxLength={8000}
            placeholder={"Paragraphs separated by blank lines.\n\nQuotes:\n> \"Quote.\" — Name, title"}
            className="border border-[var(--psc-border)] bg-white px-2 py-2 font-mono text-xs normal-case leading-relaxed"
          />
        </label>
        <label className="grid gap-1 text-xs font-semibold uppercase">
          Continue arc (optional)
          <select name="parent_instance_id" className="border border-[var(--psc-border)] bg-white px-2 py-2 text-sm normal-case">
            <option value="">New standalone story</option>
            {continueTargets.map((t) => (
              <option key={t.instance_id} value={t.instance_id}>
                Beat {t.beat_number}: {t.title.slice(0, 60)}…
              </option>
            ))}
          </select>
        </label>
        <FormSubmitButton idleLabel="Publish custom" pendingLabel="Publishing…" className={btn} />
      </form>

      {pool.length > 0 ? (
        <details className="mt-4 rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] p-3">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
            Story pool reference ({pool.length} items)
          </summary>
          <ul className="mt-3 max-h-48 space-y-2 overflow-y-auto text-[11px] text-[var(--psc-muted)]">
            {pool.map((t) => (
              <li key={t.template_key}>
                <span className="font-semibold text-[var(--psc-ink)]">{wireScopeLabel(t.category)}</span>
                {" · "}
                {wireTopicLabel(t.topic)}
                {t.is_starter ? " · starter" : ` · follows ${t.follow_up_of_template_key}`}
                <br />
                {t.title}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <form action={adminRunWireEventsTick} className="mt-4">
        <FormSubmitButton
          idleLabel="Resolve expired stories"
          pendingLabel="Running…"
          className="rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--psc-ink)] hover:bg-white"
        />
      </form>
    </section>
  );
}
