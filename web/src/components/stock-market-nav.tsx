import Link from "next/link";

export type StockMarketTab = "market" | "sectors" | "create" | "portfolio" | "trades" | "market-events";

const TABS: Array<{ id: StockMarketTab; href: string; label: string }> = [
  { id: "market", href: "/economy/stocks", label: "Stock market" },
  { id: "sectors", href: "/economy/stocks/sectors", label: "Sectors" },
  { id: "create", href: "/economy/stocks/create", label: "Incorporate a company" },
  { id: "portfolio", href: "/economy/stocks/portfolio", label: "My portfolio" },
  { id: "trades", href: "/economy/stocks/trades", label: "Public trades" },
  { id: "market-events", href: "/economy/stocks/market-events", label: "Market events" },
];

export function StockMarketNav({ active }: { active?: StockMarketTab }) {
  return (
    <nav className="flex flex-wrap gap-2 text-xs">
      {TABS.map((tab) => (
        <Link
          key={tab.id}
          href={tab.href}
          aria-current={tab.id === active ? "page" : undefined}
          className={
            tab.id === active
              ? "rounded border border-[var(--psc-ink)] bg-[var(--psc-ink)] px-3 py-1.5 font-semibold text-white"
              : "rounded border border-[var(--psc-border)] px-3 py-1.5 font-medium"
          }
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
