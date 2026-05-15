type PeerRow = {
  code: string;
  name: string;
  ground: number;
  air: number;
  naval: number;
  total: number;
};

function fmt(n: number) {
  return new Intl.NumberFormat("en-US").format(Math.max(0, Math.round(n)));
}

export function MilitaryPowerLeaderboard({
  usName,
  usPower,
  peers,
}: {
  usName: string;
  usPower: { ground: number; air: number; naval: number; total: number };
  peers: PeerRow[];
}) {
  const ranked = [...peers].sort((a, b) => b.total - a.total);
  const place = 1 + ranked.filter((p) => p.total > usPower.total).length;

  return (
    <section className="rounded-2xl border border-[var(--psc-border)] bg-white/40 p-4 shadow-sm backdrop-blur-sm">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--psc-muted)]">Military power scoreboard</h2>
      <p className="mt-1 max-w-2xl text-xs leading-relaxed text-[var(--psc-muted)]">
        Illustrative ground / air / naval index. Peer baselines are static; U.S. totals rise when the Secretary obligates
        procurement (and double on that lane when you pay the modernization surcharge). Pure scoreboard — no combat
        resolution tied to this yet.
      </p>
      <p className="mt-2 text-[11px] text-[var(--psc-muted)]">
        Rule of thumb: about <span className="font-mono">$100k</span> in a lane package →{" "}
        <span className="font-mono">+1</span> power point before domain split; modernization doubles those points and adds{" "}
        <span className="font-mono">$100M</span> to the obligation. Every country (and your U.S. line) also gains about{" "}
        <span className="font-mono">+10</span> index points once per UTC day when anyone loads State, NSC, Defense, or runs
        diplomacy actions.
      </p>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--psc-border)] text-left text-[10px] font-semibold uppercase tracking-wide text-[var(--psc-muted)]">
              <th className="py-2 pr-2">Force</th>
              <th className="py-2 pr-2 text-right">Ground</th>
              <th className="py-2 pr-2 text-right">Air</th>
              <th className="py-2 pr-2 text-right">Naval</th>
              <th className="py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-emerald-800/20 bg-emerald-50/50 font-semibold text-emerald-950">
              <td className="py-2 pr-2">
                {usName}
                <span className="ml-2 font-mono text-[10px] font-normal text-[var(--psc-muted)]">#{place}</span>
              </td>
              <td className="py-2 pr-2 text-right font-mono">{fmt(usPower.ground)}</td>
              <td className="py-2 pr-2 text-right font-mono">{fmt(usPower.air)}</td>
              <td className="py-2 pr-2 text-right font-mono">{fmt(usPower.naval)}</td>
              <td className="py-2 text-right font-mono">{fmt(usPower.total)}</td>
            </tr>
            {ranked.map((p) => (
              <tr key={p.code} className="border-b border-[var(--psc-border)]/60 text-[var(--psc-ink)]">
                <td className="py-2 pr-2">{p.name}</td>
                <td className="py-2 pr-2 text-right font-mono text-[var(--psc-muted)]">{fmt(p.ground)}</td>
                <td className="py-2 pr-2 text-right font-mono text-[var(--psc-muted)]">{fmt(p.air)}</td>
                <td className="py-2 pr-2 text-right font-mono text-[var(--psc-muted)]">{fmt(p.naval)}</td>
                <td className="py-2 text-right font-mono text-[var(--psc-muted)]">{fmt(p.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
