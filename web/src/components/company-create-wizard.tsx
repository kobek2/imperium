"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  checkTickerAvailable,
  foundPublicCompany,
  suggestCompanyTicker,
} from "@/app/actions/economy";
import {
  BUSINESS_SECTORS,
  COMPANY_STRATEGIES,
  STOCK_FOUNDING_FEE,
  STOCK_MIN_TOTAL_SHARES,
  STOCK_MIN_VALUATION,
} from "@/lib/economy-config";
import { formatUsd, initialSharePrice } from "@/lib/stock-market";

type Step = 1 | 2 | 3 | 4 | 5;

const STEPS: Array<{ n: Step; label: string }> = [
  { n: 1, label: "Sector" },
  { n: 2, label: "Profile" },
  { n: 3, label: "Strategy" },
  { n: 4, label: "Ticker" },
  { n: 5, label: "IPO" },
];

export function CompanyCreateWizard() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [step, setStep] = useState<Step>(1);
  const [flash, setFlash] = useState<{ ok: boolean; message: string } | null>(null);

  const [sector, setSector] = useState<(typeof BUSINESS_SECTORS)[number]["key"]>(BUSINESS_SECTORS[0].key);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [primaryFocus, setPrimaryFocus] = useState("");
  const [strategy, setStrategy] = useState<(typeof COMPANY_STRATEGIES)[number]["key"]>("stable");
  const [ticker, setTicker] = useState("");
  const [tickerStatus, setTickerStatus] = useState<"idle" | "checking" | "ok" | "taken" | "invalid" | "error">("idle");
  const [tickerMessage, setTickerMessage] = useState<string | null>(null);
  const tickerTouched = useRef(false);
  const tickerCheckId = useRef(0);
  const [valuation, setValuation] = useState(100_000_000);
  const [totalShares, setTotalShares] = useState(10_000_000);
  const [publicShares, setPublicShares] = useState(3_000_000);

  const founderShares = Math.max(0, totalShares - publicShares);
  const founderPct = totalShares > 0 ? (founderShares / totalShares) * 100 : 0;
  const publicPct = totalShares > 0 ? (publicShares / totalShares) * 100 : 0;
  const ipoPrice = initialSharePrice(valuation, totalShares);
  const majorityOk = founderShares > totalShares / 2;

  const canAdvance = useMemo(() => {
    if (step === 1) return Boolean(sector);
    if (step === 2) return name.trim().length >= 3 && description.trim().length > 0 && primaryFocus.trim().length > 0;
    if (step === 3) return Boolean(strategy);
    if (step === 4) return ticker.length >= 3 && ticker.length <= 5 && tickerStatus === "ok";
    return (
      valuation >= STOCK_MIN_VALUATION &&
      totalShares >= STOCK_MIN_TOTAL_SHARES &&
      publicShares >= 1 &&
      publicShares < totalShares &&
      majorityOk
    );
  }, [step, sector, name, description, primaryFocus, strategy, ticker, tickerStatus, valuation, totalShares, publicShares, majorityOk]);

  useEffect(() => {
    if (step !== 4 || name.trim().length < 3 || tickerTouched.current) return;
    let cancelled = false;
    (async () => {
      const r = await suggestCompanyTicker(name);
      if (cancelled || !r.ok || !r.ticker) return;
      const suggested = r.ticker.trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 5);
      if (!suggested) return;
      setTicker((prev) => (prev ? prev : suggested));
    })();
    return () => {
      cancelled = true;
    };
  }, [step, name]);

  useEffect(() => {
    if (step !== 4) return;
    const normalized = ticker.trim().toUpperCase().replace(/[^A-Z]/g, "");
    if (normalized !== ticker) {
      setTicker(normalized);
      return;
    }
    if (normalized.length < 3 || normalized.length > 5) {
      setTickerStatus(normalized.length === 0 ? "idle" : "invalid");
      setTickerMessage(normalized.length === 0 ? null : "Must be 3–5 uppercase letters.");
      return;
    }
    const checkId = ++tickerCheckId.current;
    setTickerStatus("checking");
    setTickerMessage("Checking availability…");
    (async () => {
      try {
        const r = await checkTickerAvailable(normalized);
        if (checkId !== tickerCheckId.current) return;
        if (!r.ok) {
          setTickerStatus("error");
          setTickerMessage(r.message ?? "Could not verify ticker. Try again.");
          return;
        }
        if (!r.available) {
          const formatMessage = "Ticker must be 3–5 uppercase letters.";
          if (r.message === formatMessage) {
            setTickerStatus("invalid");
            setTickerMessage(formatMessage);
            return;
          }
          setTickerStatus("taken");
          setTickerMessage("Ticker already taken.");
          return;
        }
        setTickerStatus("ok");
        setTickerMessage("Ticker available.");
      } catch {
        if (checkId !== tickerCheckId.current) return;
        setTickerStatus("error");
        setTickerMessage("Could not verify ticker. Try again.");
      }
    })();
  }, [step, ticker]);

  function submit() {
    start(async () => {
      setFlash(null);
      const fd = new FormData();
      fd.set("name", name.trim());
      fd.set("description", description.trim());
      fd.set("primary_focus", primaryFocus.trim());
      fd.set("sector", sector);
      fd.set("strategy", strategy);
      fd.set("ticker", ticker);
      fd.set("valuation", String(valuation));
      fd.set("total_shares", String(Math.floor(totalShares)));
      fd.set("public_shares", String(Math.floor(publicShares)));
      const r = await foundPublicCompany(fd);
      setFlash(r);
      if (r.ok && r.ticker) {
        router.push(`/economy/stocks/${r.ticker}`);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-6">
      <nav className="flex flex-wrap gap-2 text-xs">
        {STEPS.map((s) => (
          <span
            key={s.n}
            className={`rounded border px-2 py-1 ${step === s.n ? "border-[var(--psc-ink)] bg-[var(--psc-ink)] text-white" : step > s.n ? "border-[var(--psc-border)] text-[var(--psc-muted)]" : "border-[var(--psc-border)] text-[var(--psc-muted)]"}`}
          >
            {s.n}. {s.label}
          </span>
        ))}
      </nav>

      {flash ? (
        <div
          role="status"
          className={`rounded border px-3 py-2 text-sm ${flash.ok ? "border-[var(--psc-border)]" : "border-rose-300 bg-rose-50 text-rose-950"}`}
        >
          {flash.message}
        </div>
      ) : null}

      <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5">
        {step === 1 ? (
          <>
            <h2 className="text-base font-semibold">Select sector</h2>
            <p className="mt-1 text-xs text-[var(--psc-muted)]">Choose the industry your company operates in.</p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {BUSINESS_SECTORS.map((s) => (
                <label
                  key={s.key}
                  className={`flex cursor-pointer items-center gap-2 rounded border px-3 py-2 text-sm ${sector === s.key ? "border-[var(--psc-ink)] bg-[var(--psc-surface)]" : "border-[var(--psc-border)]"}`}
                >
                  <input type="radio" name="sector" checked={sector === s.key} onChange={() => setSector(s.key)} />
                  {s.label}
                </label>
              ))}
            </div>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <h2 className="text-base font-semibold">Company profile</h2>
            <p className="mt-1 text-xs text-[var(--psc-muted)]">Sector: {BUSINESS_SECTORS.find((s) => s.key === sector)?.label}</p>
            <div className="mt-4 grid max-w-xl gap-3 text-sm">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Company name"
                minLength={3}
                className="border border-[var(--psc-border)] px-3 py-2"
              />
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Company description"
                rows={4}
                className="border border-[var(--psc-border)] px-3 py-2"
              />
              <input
                value={primaryFocus}
                onChange={(e) => setPrimaryFocus(e.target.value)}
                placeholder="Primary focus (e.g. Cybersecurity and military technology)"
                className="border border-[var(--psc-border)] px-3 py-2"
              />
            </div>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <h2 className="text-base font-semibold">Company strategy</h2>
            <p className="mt-1 text-xs text-[var(--psc-muted)]">Strategy affects how aggressively share prices move on trades.</p>
            <div className="mt-4 grid gap-2">
              {COMPANY_STRATEGIES.map((s) => (
                <label
                  key={s.key}
                  className={`flex cursor-pointer flex-col gap-1 rounded border px-3 py-3 text-sm ${strategy === s.key ? "border-[var(--psc-ink)] bg-[var(--psc-surface)]" : "border-[var(--psc-border)]"}`}
                >
                  <span className="flex items-center gap-2 font-medium">
                    <input type="radio" name="strategy" checked={strategy === s.key} onChange={() => setStrategy(s.key)} />
                    {s.label}
                  </span>
                  <span className="pl-6 text-xs text-[var(--psc-muted)]">{s.description}</span>
                </label>
              ))}
            </div>
          </>
        ) : null}

        {step === 4 ? (
          <>
            <h2 className="text-base font-semibold">Stock ticker</h2>
            <p className="mt-1 text-xs text-[var(--psc-muted)]">
              Unique 3–5 letter trading symbol for {name || "your company"}.
            </p>
            <div className="mt-4 max-w-xs">
              <input
                value={ticker}
                onChange={(e) => {
                  tickerTouched.current = true;
                  setTicker(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 5));
                }}
                placeholder="TDS"
                className="w-full border border-[var(--psc-border)] px-3 py-2 font-mono text-lg tracking-widest"
                maxLength={5}
              />
              {tickerMessage ? (
                <p
                  className={`mt-2 text-xs ${
                    tickerStatus === "ok"
                      ? "text-emerald-700"
                      : tickerStatus === "checking" || tickerStatus === "idle"
                        ? "text-[var(--psc-muted)]"
                        : "text-rose-700"
                  }`}
                >
                  {tickerMessage}
                </p>
              ) : null}
            </div>
          </>
        ) : null}

        {step === 5 ? (
          <>
            <h2 className="text-base font-semibold">IPO setup</h2>
            <p className="mt-1 text-xs text-[var(--psc-muted)]">
              Founding fee: {formatUsd(STOCK_FOUNDING_FEE)} (deducted from your wallet). Founder must keep majority ownership.
            </p>
            <div className="mt-4 grid max-w-xl gap-3 text-sm">
              <label className="grid gap-1">
                <span className="text-xs text-[var(--psc-muted)]">Company valuation</span>
                <input
                  type="number"
                  min={STOCK_MIN_VALUATION}
                  step={1_000_000}
                  value={valuation}
                  onChange={(e) => setValuation(Number(e.target.value))}
                  className="border border-[var(--psc-border)] px-3 py-2 font-mono"
                />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-[var(--psc-muted)]">Total shares</span>
                <input
                  type="number"
                  min={STOCK_MIN_TOTAL_SHARES}
                  step={1000}
                  value={totalShares}
                  onChange={(e) => setTotalShares(Number(e.target.value))}
                  className="border border-[var(--psc-border)] px-3 py-2 font-mono"
                />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-[var(--psc-muted)]">Public shares (for trading)</span>
                <input
                  type="number"
                  min={1}
                  max={totalShares - 1}
                  step={1000}
                  value={publicShares}
                  onChange={(e) => setPublicShares(Number(e.target.value))}
                  className="border border-[var(--psc-border)] px-3 py-2 font-mono"
                />
              </label>
            </div>
            <dl className="mt-4 grid max-w-md gap-2 rounded border border-[var(--psc-border)] bg-[var(--psc-surface)] p-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-[var(--psc-muted)]">Founder shares</dt>
                <dd className="font-mono">{founderShares.toLocaleString()} ({founderPct.toFixed(1)}%)</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--psc-muted)]">Public shares</dt>
                <dd className="font-mono">{publicShares.toLocaleString()} ({publicPct.toFixed(1)}%)</dd>
              </div>
              <div className="flex justify-between border-t border-[var(--psc-border)] pt-2">
                <dt className="text-[var(--psc-muted)]">Initial stock price</dt>
                <dd className="font-mono">{formatUsd(ipoPrice, { decimals: 2 })}</dd>
              </div>
              {!majorityOk ? (
                <p className="text-xs text-rose-700">Founder must retain more than 50% of shares.</p>
              ) : null}
            </dl>
          </>
        ) : null}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          {step > 1 ? (
            <button
              type="button"
              onClick={() => setStep((s) => (s - 1) as Step)}
              className="rounded border border-[var(--psc-border)] px-4 py-2 text-xs font-medium"
            >
              Back
            </button>
          ) : (
            <Link href="/economy/stocks" className="rounded border border-[var(--psc-border)] px-4 py-2 text-xs font-medium">
              Cancel
            </Link>
          )}
          {step < 5 ? (
            <button
              type="button"
              disabled={!canAdvance}
              onClick={() => setStep((s) => (s + 1) as Step)}
              className="rounded border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
            >
              Continue
            </button>
          ) : (
            <button
              type="button"
              disabled={pending || !canAdvance}
              onClick={submit}
              className="rounded border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
            >
              {pending ? "Incorporating…" : `Pay ${formatUsd(STOCK_FOUNDING_FEE)} & go public`}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
