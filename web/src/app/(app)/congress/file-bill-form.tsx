"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { submitBill } from "@/app/actions/bills";
import type { CompanyLobbyOfferRow } from "@/app/actions/economy";
import { listBillTemplates, type BillTemplateRow } from "@/app/actions/bill-templates";
import { BillRichTextEditorWithHiddenInput } from "@/components/bill-rich-text-editor";
import { BillEconomicImpactFields } from "@/components/bill-economic-impact-fields";
import { SubmitButton } from "@/components/submit-button";
import type { OwnedCompanyForFiling } from "@/lib/load-company-lobby-filing-context";
import {
  buildSectorBillMarkdown,
  buildSectorBillTitle,
  defaultStockEffectFromPolicyTags,
  formatSectorEffectPct,
  sectorFromIssueKey,
  SECTOR_BILL_MEASURES,
} from "@/lib/legislation-stock";
import { legacyMdToEditorHtml, sanitizeBillHtml } from "@/lib/sanitize-bill-html";
import { companyDisplayName, formatUsd, sectorLabel } from "@/lib/stock-market";

type Stance = {
  stance_key: string;
  label: string;
  summary: string;
  full_text: string;
  policy_value: number;
};

function parseStances(raw: unknown): Stance[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(Boolean) as Stance[];
}

function spectrumPct(policyValue: number): number {
  return Math.max(0, Math.min(100, ((policyValue + 2) / 4) * 100));
}

function normalizeOfficialStanceLabel(label: string): string {
  return label.replaceAll(" + ", " and ").replaceAll("+", " and ").trim();
}

/** Blurred stand-in for the Change Policy flow; full overlay until the next Congress unlocks server-side. */
function ChangePolicyLockedZone({
  congressLabel,
  detailMessage,
}: {
  congressLabel: string | null;
  detailMessage: string | null;
}) {
  return (
    <section
      className="relative isolate min-h-[240px] overflow-hidden rounded-xl border border-[var(--psc-border)] bg-[var(--psc-panel)] shadow-inner"
      aria-label="Change Policy filing locked for this congressional term"
    >
      <div className="pointer-events-none select-none p-4 blur-[3px] opacity-[0.22]" aria-hidden="true">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Preset issues</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 rounded-lg border border-[var(--psc-border)] bg-[var(--psc-canvas)]" />
          ))}
        </div>
        <div className="mt-6 space-y-3">
          <div className="h-3 w-1/3 rounded bg-[var(--psc-border)]" />
          <div className="h-16 rounded-lg border border-[var(--psc-border)] bg-white" />
          <div className="h-16 rounded-lg border border-[var(--psc-border)] bg-white" />
        </div>
      </div>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[color-mix(in_srgb,var(--psc-canvas)_88%,var(--psc-ink))] px-5 py-10 text-center backdrop-blur-[2px]">
        <div className="rounded-full border border-[var(--psc-border)] bg-white/90 p-3 shadow-sm">
          <svg className="h-8 w-8 text-[var(--psc-ink)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
            <path
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M7 11V8a5 5 0 0110 0v3M6 11h12v10H6V11z"
            />
          </svg>
        </div>
        <div>
          <h4 className="text-sm font-bold text-[var(--psc-ink)]">Change Policy locked</h4>
          {congressLabel ? (
            <p className="mt-1 text-xs font-semibold text-[var(--psc-muted)]">Your filing for {congressLabel} is already used.</p>
          ) : (
            <p className="mt-1 text-xs font-semibold text-[var(--psc-muted)]">Your Change Policy filing for this term is already used.</p>
          )}
        </div>
        {detailMessage ? <p className="max-w-md text-xs leading-relaxed text-[var(--psc-ink)]">{detailMessage}</p> : null}
        <p className="max-w-sm text-[11px] text-[var(--psc-muted)]">
          This area unlocks automatically when the simulation calendar enters the next congressional term. Custom bills below
          stay available.
        </p>
      </div>
    </section>
  );
}

function sectorContentHtml(md: string): string {
  return sanitizeBillHtml(legacyMdToEditorHtml(md) ?? `<pre>${md}</pre>`);
}

export function FileBillForm({
  originatingChamber,
  crisisStoryArcId = null,
  changePolicyBlocked = false,
  changePolicyBlockedMessage = null,
  changePolicyCongressLabel = null,
  lobbyOffers = [],
  ownedCompanies = [],
}: {
  originatingChamber: "house" | "senate";
  /** When true, "Change Policy" (preset template) filing is disabled for this user this Congress. */
  changePolicyBlocked?: boolean;
  changePolicyBlockedMessage?: string | null;
  /** e.g. "119th Congress" — shown on the lock overlay. */
  changePolicyCongressLabel?: string | null;
  lobbyOffers?: CompanyLobbyOfferRow[];
  ownedCompanies?: OwnedCompanyForFiling[];
  /** When set, filed legislation is linked to an active newsroom crisis arc. */
  crisisStoryArcId?: string | null;
}) {
  const [mode, setMode] = useState<"free" | "template" | "sector">("free");
  const [templates, setTemplates] = useState<BillTemplateRow[]>([]);
  const [selectedTpl, setSelectedTpl] = useState<BillTemplateRow | null>(null);
  const [stance, setStance] = useState<Stance | null>(null);
  const [selectedLobbyOffer, setSelectedLobbyOffer] = useState<CompanyLobbyOfferRow | null>(null);
  const [founderCompanyId, setFounderCompanyId] = useState(ownedCompanies[0]?.id ?? "");
  const [founderMeasureKey, setFounderMeasureKey] = useState<(typeof SECTOR_BILL_MEASURES)[number]["key"]>("subsidy");
  const router = useRouter();

  const showSectorMode = lobbyOffers.length > 0 || ownedCompanies.length > 0;
  const founderCompany = ownedCompanies.find((c) => c.id === founderCompanyId) ?? ownedCompanies[0] ?? null;
  const founderPreview = useMemo(() => {
    if (!founderCompany) return null;
    const title = buildSectorBillTitle(founderCompany.sector, founderMeasureKey, founderCompany.name);
    const md = buildSectorBillMarkdown(
      founderCompany.sector,
      founderMeasureKey,
      founderCompany.name,
      founderCompany.ticker_symbol,
    );
    const measure = SECTOR_BILL_MEASURES.find((m) => m.key === founderMeasureKey);
    return { title, md, effect: measure?.stockEffect ?? 15 };
  }, [founderCompany, founderMeasureKey]);

  async function submitBillThenRefresh(formData: FormData) {
    await submitBill(formData);
    router.refresh();
  }

  useEffect(() => {
    void listBillTemplates().then(setTemplates);
  }, []);

  useEffect(() => {
    if (crisisStoryArcId) setMode("free");
  }, [crisisStoryArcId]);

  useEffect(() => {
    if (changePolicyBlocked && mode === "template") {
      setMode("free");
      setSelectedTpl(null);
      setStance(null);
    }
  }, [changePolicyBlocked, mode]);

  const policyTagsJson =
    selectedTpl && stance
      ? JSON.stringify({
          issue_key: selectedTpl.issue_key,
          stance_key: stance.stance_key,
          policy_value: stance.policy_value,
        })
      : "";

  const modeToggle = (
    <div className="flex flex-wrap gap-2 rounded border border-[var(--psc-border)] bg-[var(--psc-canvas)] p-2 text-sm">
      <button
        type="button"
        className={`rounded px-3 py-1.5 font-semibold ${
          mode === "free" ? "bg-[var(--psc-ink)] text-white" : "text-[var(--psc-muted)]"
        }`}
        onClick={() => setMode("free")}
      >
        Write my own bill
      </button>
      <button
        type="button"
        disabled={changePolicyBlocked}
        title={changePolicyBlocked ? "Change Policy limit reached for this congressional term" : undefined}
        className={`rounded px-3 py-1.5 font-semibold ${
          mode === "template" ? "bg-[var(--psc-ink)] text-white" : "text-[var(--psc-muted)]"
        } ${changePolicyBlocked ? "cursor-not-allowed opacity-45" : ""}`}
        onClick={() => {
          if (changePolicyBlocked) return;
          setMode("template");
          setSelectedTpl(null);
          setStance(null);
          setSelectedLobbyOffer(null);
        }}
      >
        Change Policy
      </button>
      {showSectorMode ? (
        <button
          type="button"
          className={`rounded px-3 py-1.5 font-semibold ${
            mode === "sector" ? "bg-[var(--psc-ink)] text-white" : "text-[var(--psc-muted)]"
          }`}
          onClick={() => {
            setMode("sector");
            setSelectedTpl(null);
            setStance(null);
            setSelectedLobbyOffer(lobbyOffers[0] ?? null);
          }}
        >
          Company sectors
        </button>
      ) : null}
    </div>
  );

  const showTemplateFlow = !changePolicyBlocked && mode === "template";
  const showCustomForm = mode === "free";
  const showSectorFlow = mode === "sector" && showSectorMode;

  const stances = selectedTpl ? parseStances(selectedTpl.stances) : [];

  return (
    <div className="mt-4 space-y-4">
      {crisisStoryArcId ? (
        <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-950">
          <span className="font-semibold">Crisis legislation.</span> This bill will be linked to the active newsroom
          crisis. Write your own emergency measure below.
        </div>
      ) : null}
      {modeToggle}

      {changePolicyBlocked ? (
        <ChangePolicyLockedZone congressLabel={changePolicyCongressLabel} detailMessage={changePolicyBlockedMessage} />
      ) : null}

      {showTemplateFlow ? (
        <>
          <p className="text-xs text-[var(--psc-muted)]">
            One Change Policy (preset issue) bill per two-year congressional term per member; custom bills are unlimited.
          </p>
          {!selectedTpl ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="rounded-lg border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4 text-left transition hover:border-[var(--psc-accent)]"
                  onClick={() => {
                    setSelectedTpl(t);
                    setStance(null);
                  }}
                >
                  <p className="text-sm font-semibold text-[var(--psc-ink)]">{t.display_name}</p>
                  <p className="mt-1 text-xs text-[var(--psc-muted)]">{t.description}</p>
                </button>
              ))}
            </div>
          ) : !stance ? (
            <div className="space-y-3">
              <button
                type="button"
                className="text-xs font-semibold text-[var(--psc-accent)] underline"
                onClick={() => setSelectedTpl(null)}
              >
                ← Back to issues
              </button>
              <p className="text-sm font-semibold text-[var(--psc-ink)]">Choose a stance for {selectedTpl.display_name}</p>
              <div className="grid gap-3">
                {stances.map((s) => (
                  <label
                    key={s.stance_key}
                    className="flex cursor-pointer gap-3 rounded-lg border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4 has-[:checked]:border-[var(--psc-accent)]"
                  >
                    <input
                      type="radio"
                      name="stance_pick"
                      className="mt-1"
                      checked={false}
                      onChange={() => setStance(s)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="text-sm font-semibold text-[var(--psc-ink)]">{s.label}</span>
                      <span className="mt-1 block text-xs text-[var(--psc-muted)]">{s.summary}</span>
                      <span className="mt-2 block">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
                          Policy position
                        </span>
                        <span className="relative mt-1 block h-2 w-full rounded-full bg-gradient-to-r from-red-500 via-slate-300 to-blue-600">
                          <span
                            className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[var(--psc-ink)] shadow"
                            style={{ left: `${spectrumPct(s.policy_value)}%` }}
                          />
                        </span>
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ) : (
            <form action={submitBillThenRefresh} className="grid gap-4 md:grid-cols-2">
              <input type="hidden" name="originating_chamber" value={originatingChamber} />
              <input type="hidden" name="template_id" value={selectedTpl.id} />
              <input type="hidden" name="policy_tags_json" value={policyTagsJson} />
              <input type="hidden" name="template_core_md" value={stance.full_text} />

              <button
                type="button"
                className="text-left text-xs font-semibold text-[var(--psc-accent)] underline md:col-span-2"
                onClick={() => setStance(null)}
              >
                ← Change stance
              </button>

              <label className="grid gap-2 text-sm font-semibold md:col-span-2">
                Title
                <input
                  key={stance.stance_key}
                  name="title"
                  required
                  defaultValue={`${selectedTpl.display_name} Act — ${normalizeOfficialStanceLabel(stance.label)}`}
                  className="border border-[var(--psc-border)] bg-white px-3 py-2 font-normal"
                />
              </label>

              <div className="grid gap-2 text-sm font-semibold md:col-span-2">
                <span>Optional preamble / personal statement</span>
                <p className="text-xs font-normal text-[var(--psc-muted)]">
                  Appears before the statutory template text. The template text itself cannot be changed.
                </p>
                <BillRichTextEditorWithHiddenInput fieldName="preamble_html" />
              </div>

              <div className="md:col-span-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
                  Statutory text (read-only)
                </p>
                <div
                  className="mt-2 max-h-80 overflow-y-auto rounded border border-[var(--psc-border)] bg-white p-3 text-sm [&_p]:mb-2"
                  dangerouslySetInnerHTML={{
                    __html: sanitizeBillHtml(legacyMdToEditorHtml(stance.full_text) ?? ""),
                  }}
                />
              </div>

              <BillEconomicImpactFields
                defaultSector={sectorFromIssueKey(selectedTpl.issue_key)}
                defaultEffect={defaultStockEffectFromPolicyTags({
                  issue_key: selectedTpl.issue_key,
                  stance_key: stance.stance_key,
                  policy_value: stance.policy_value,
                })}
              />

              <SubmitButton
                pendingLabel="Filing…"
                className="border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-4 py-2 text-sm font-semibold uppercase tracking-wide text-white md:col-span-2 hover:brightness-110"
              >
                {originatingChamber === "house" ? "File House bill" : "File Senate bill"}
              </SubmitButton>
            </form>
          )}
        </>
      ) : null}

      {showCustomForm ? (
        <>
          <div className="rounded-lg border border-[var(--psc-border)] border-dashed bg-[var(--psc-canvas)]/60 px-3 py-2">
            <p className="text-xs text-[var(--psc-muted)]">
              <span className="font-semibold text-[var(--psc-ink)]">Custom bills</span> — no limit per term. Change Policy
              (preset issues) is limited to one per two-year congressional term per member.
              {showSectorMode ? (
                <>
                  {" "}
                  <span className="font-semibold text-[var(--psc-ink)]">Company sectors</span> bills support industry
                  legislation with market impact.
                </>
              ) : null}
            </p>
          </div>
          <form action={submitBillThenRefresh} className="grid gap-4 md:grid-cols-2">
            <input type="hidden" name="originating_chamber" value={originatingChamber} />
            {crisisStoryArcId ? (
              <input type="hidden" name="crisis_story_arc_id" value={crisisStoryArcId} />
            ) : null}
            <label className="grid gap-2 text-sm font-semibold md:col-span-2">
              Title
              <input
                name="title"
                required
                className="border border-[var(--psc-border)] bg-white px-3 py-2 font-normal"
              />
            </label>
            <div className="grid gap-2 text-sm font-semibold md:col-span-2">
              <span>Bill text</span>
              <p className="text-xs font-normal text-[var(--psc-muted)]">
                Use the toolbar for bold, italic, underline, headings, lists, and alignment. Formatting is saved as written.
              </p>
              <BillRichTextEditorWithHiddenInput fieldName="content_html" />
            </div>
            <BillEconomicImpactFields />
            <SubmitButton
              pendingLabel="Filing…"
              className="border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-4 py-2 text-sm font-semibold uppercase tracking-wide text-white md:col-span-2 hover:brightness-110"
            >
              {originatingChamber === "house" ? "File House bill" : "File Senate bill"}
            </SubmitButton>
          </form>
        </>
      ) : null}

      {showSectorFlow ? (
        <div className="space-y-4">
          <p className="text-xs text-[var(--psc-muted)]">
            File sector legislation tied to public companies. Shareholders can file bills funded by a company founder&apos;s
            lobby payment. Founders may also file directly for their own companies. When signed into law, the bill moves all
            public companies in the affected sector.
          </p>

          {lobbyOffers.length > 0 ? (
            <section className="rounded-lg border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
              <h4 className="text-sm font-semibold">Lobby offers from founders</h4>
              <p className="mt-1 text-xs text-[var(--psc-muted)]">
                You were paid to introduce one of these sector bills in {originatingChamber === "house" ? "the House" : "the Senate"}.
              </p>
              <ul className="mt-3 space-y-2">
                {lobbyOffers.map((offer) => (
                  <li key={offer.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedLobbyOffer(offer)}
                      className={`w-full rounded border px-3 py-2 text-left text-sm ${
                        selectedLobbyOffer?.id === offer.id
                          ? "border-[var(--psc-ink)] bg-[var(--psc-surface)]"
                          : "border-[var(--psc-border)]"
                      }`}
                    >
                      <p className="font-medium">
                        {companyDisplayName(offer.company_name, offer.ticker_symbol)} — {offer.bill_title}
                      </p>
                      <p className="mt-1 text-xs text-[var(--psc-muted)]">
                        Paid {formatUsd(offer.amount)} · {sectorLabel(offer.affected_sector)}{" "}
                        {formatSectorEffectPct(offer.stock_market_effect)}
                        {offer.message ? ` · “${offer.message}”` : ""}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>

              {selectedLobbyOffer ? (
                <form action={submitBillThenRefresh} className="mt-4 grid gap-3">
                  <input type="hidden" name="originating_chamber" value={originatingChamber} />
                  <input type="hidden" name="filing_kind" value="company_sector" />
                  <input type="hidden" name="lobby_offer_id" value={selectedLobbyOffer.id} />
                  <input type="hidden" name="title" value={selectedLobbyOffer.bill_title} />
                  <input type="hidden" name="content_md" value={selectedLobbyOffer.bill_content_md} />
                  <input
                    type="hidden"
                    name="content_html"
                    value={sectorContentHtml(selectedLobbyOffer.bill_content_md)}
                  />
                  <input type="hidden" name="affected_sector" value={selectedLobbyOffer.affected_sector} />
                  <input type="hidden" name="stock_market_effect" value={String(selectedLobbyOffer.stock_market_effect)} />
                  <div className="rounded border border-[var(--psc-border)] bg-white p-3 text-sm">
                    <p className="font-semibold">{selectedLobbyOffer.bill_title}</p>
                    <p className="mt-1 text-xs text-[var(--psc-muted)]">
                      Market impact if enacted: {sectorLabel(selectedLobbyOffer.affected_sector)}{" "}
                      {formatSectorEffectPct(selectedLobbyOffer.stock_market_effect)}
                    </p>
                  </div>
                  <SubmitButton
                    pendingLabel="Filing…"
                    className="w-fit border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-4 py-2 text-xs font-semibold text-white"
                  >
                    {originatingChamber === "house" ? "File House sector bill" : "File Senate sector bill"}
                  </SubmitButton>
                </form>
              ) : null}
            </section>
          ) : null}

          {ownedCompanies.length > 0 ? (
            <section className="rounded-lg border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
              <h4 className="text-sm font-semibold">File for your company</h4>
              <p className="mt-1 text-xs text-[var(--psc-muted)]">
                Founders may introduce sector legislation directly without a lobby payment.
              </p>
              {founderPreview && founderCompany ? (
                <form action={submitBillThenRefresh} className="mt-4 grid gap-3">
                  <input type="hidden" name="originating_chamber" value={originatingChamber} />
                  <input type="hidden" name="filing_kind" value="company_sector" />
                  <input type="hidden" name="company_id" value={founderCompany.id} />
                  <input type="hidden" name="measure_key" value={founderMeasureKey} />
                  <input type="hidden" name="title" value={founderPreview.title} />
                  <input type="hidden" name="content_md" value={founderPreview.md} />
                  <input type="hidden" name="content_html" value={sectorContentHtml(founderPreview.md)} />
                  <input type="hidden" name="affected_sector" value={founderCompany.sector} />
                  <input type="hidden" name="stock_market_effect" value={String(founderPreview.effect)} />

                  <label className="grid gap-1 text-sm">
                    <span className="text-xs font-semibold text-[var(--psc-muted)]">Company</span>
                    <select
                      value={founderCompanyId}
                      onChange={(e) => setFounderCompanyId(e.target.value)}
                      className="border border-[var(--psc-border)] bg-white px-3 py-2"
                    >
                      {ownedCompanies.map((c) => (
                        <option key={c.id} value={c.id}>
                          {companyDisplayName(c.name, c.ticker_symbol)} — {sectorLabel(c.sector)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="grid gap-1 text-sm">
                    <span className="text-xs font-semibold text-[var(--psc-muted)]">Legislation type</span>
                    <select
                      value={founderMeasureKey}
                      onChange={(e) =>
                        setFounderMeasureKey(e.target.value as (typeof SECTOR_BILL_MEASURES)[number]["key"])
                      }
                      className="border border-[var(--psc-border)] bg-white px-3 py-2"
                    >
                      {SECTOR_BILL_MEASURES.map((m) => (
                        <option key={m.key} value={m.key}>
                          {m.label} ({formatSectorEffectPct(m.stockEffect)})
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="rounded border border-[var(--psc-border)] bg-white p-3 text-sm">
                    <p className="font-semibold">{founderPreview.title}</p>
                    <p className="mt-1 text-xs text-[var(--psc-muted)]">
                      Market impact if enacted: {sectorLabel(founderCompany.sector)}{" "}
                      {formatSectorEffectPct(founderPreview.effect)}
                    </p>
                  </div>

                  <SubmitButton
                    pendingLabel="Filing…"
                    className="w-fit border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-4 py-2 text-xs font-semibold text-white"
                  >
                    {originatingChamber === "house" ? "File House sector bill" : "File Senate sector bill"}
                  </SubmitButton>
                </form>
              ) : null}
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
