export function AdminBaselinePlaybook() {
  return (
    <section className="rounded-xl border border-[var(--psc-border)] bg-[var(--psc-panel)] p-5">
      <h2 className="text-lg font-semibold text-[var(--psc-ink)]">Baseline playbook</h2>
      <p className="mt-1 text-sm text-[var(--psc-muted)]">
        Manual city elections — mayor plus seven council wards (W01–W07). NPC incumbents start with a capped
        +15 campaign advantage; they gain +3 points every 3 hours during general so player campaigns can catch up.
      </p>
      <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-[var(--psc-ink)]">
        <li>
          <strong>Wipe game history</strong> above when starting a fresh season (full reset including NYC city sim,
          wave-1 elections, and RP calendar re-anchor to January 2032).
        </li>
        <li>
          Have players finish <strong>Character</strong> and pick a home council district (W01–W07).
        </li>
        <li>
          <strong>Create races</strong> from Admin → New race (mayor citywide or council ward). Boot dormant
          templates via Campaign Manager if needed.
        </li>
        <li>
          Advance each race through filing → primary → general → closed (timestamps are cosmetic; use
          force-advance on the race detail page if needed).
        </li>
        <li>
          Winners seat on the <strong>City Council</strong> page; council legislation and budget follow the
          admin-controlled sim week (one week = one metrics tick + campaign turn when active).
        </li>
        <li>
          Staff advances the sim week from <strong>Admin → Elections → City sim week</strong> when players are
          ready — not on wall-clock timers.
        </li>
      </ol>
      <p className="mt-3 text-xs text-[var(--psc-muted)]">
        Legacy federal House/Senate/President rows may still exist in the database but are not the active play
        surface this season.
      </p>
    </section>
  );
}
