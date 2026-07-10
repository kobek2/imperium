"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  collectCityOfficeSalary,
  type CityOfficeSalaryResult,
} from "@/app/actions/city-office-salary";
import { formatFiscalCurrency } from "@/lib/city-fiscal-data";

export type OfficeSalaryAccrual = {
  accruedUsd: number;
  roleKey: string | null;
  accrualCapped: boolean;
  collectionDeadlineAt: string | null;
};

export function OfficeSalaryCollectPanel({ accrual }: { accrual: OfficeSalaryAccrual | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [flash, setFlash] = useState<CityOfficeSalaryResult | null>(null);

  if (!accrual?.roleKey) return null;

  function collect() {
    start(async () => {
      const result = await collectCityOfficeSalary();
      setFlash(result);
      if (result.ok) router.refresh();
    });
  }

  return (
    <section className="rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
        Office salary
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <p className="text-lg font-semibold tabular-nums text-[var(--psc-ink)]">
          {formatFiscalCurrency(accrual.accruedUsd)}
        </p>
        {accrual.accrualCapped ? (
          <span className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-900">
            Forfeited last week
          </span>
        ) : null}
        <button
          type="button"
          disabled={pending || accrual.accruedUsd <= 0}
          onClick={collect}
          className="rounded bg-[var(--psc-accent)] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          Collect salary
        </button>
      </div>
      {flash ? (
        <p
          className={`mt-2 text-xs ${flash.ok ? "text-green-800" : "text-red-700"}`}
          role="status"
        >
          {flash.message}
        </p>
      ) : null}
    </section>
  );
}
