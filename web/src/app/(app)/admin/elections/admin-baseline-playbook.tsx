export function AdminBaselinePlaybook() {
  return (
    <section className="rounded-xl border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5">
      <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Baseline playbook</h2>
      <p className="mt-1 text-sm text-[var(--psc-muted)]">
        Manual elections only — no RP calendar automation, auto seat cycles, or fiscal gates. Three regions (
        NE / SO / WE), ten House districts, three Senate classes, national president (points-only outcomes).
      </p>
      <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-[var(--psc-ink)]">
        <li>
          <strong>Wipe game history</strong> above when starting a fresh season (clears races, bills,
          wallets activity, grants).
        </li>
        <li>
          Have players finish <strong>Character</strong> (region + district for House hopefuls).
        </li>
        <li>
          <strong>Create races</strong> or use congress appointments for vacant seats / executive
          offices.
        </li>
        <li>
          Advance each race through filing → primary → general → closed (timestamps are cosmetic;
          use force-advance on the race detail page if needed).
        </li>
        <li>
          After House/Senate seats close, players file bills from <strong>Congress</strong> (floor
          votes, 24h default).
        </li>
      </ol>
      <p className="mt-3 text-xs text-[var(--psc-muted)]">
        Disabled in baseline: Oval Office, policy shop, cabinet, hopper pipeline, federal budget UI,
        world chat dock, automated calendar scheduling, running mates.
      </p>
    </section>
  );
}
