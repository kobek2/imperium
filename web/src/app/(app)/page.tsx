import Link from "next/link";
import { redirect } from "next/navigation";
import { BriefingInbox } from "@/components/briefing-inbox";
import { fetchBriefingMoments } from "@/lib/briefing-inbox";
import { tryCreateClient } from "@/lib/supabase/server";

const TILES = [
  {
    href: "/character",
    title: "Character",
    subtitle: "Name, party, home district.",
  },
  {
    href: "/economy",
    title: "Economy",
    subtitle: "Wallet, PAC, campaign tools.",
  },
  {
    href: "/parties",
    title: "Parties",
    subtitle: "DNC / RNC rooms and leadership.",
  },
  {
    href: "/elections",
    title: "Elections",
    subtitle: "File, vote, follow live races.",
  },
  {
    href: "/congress",
    title: "Congress",
    subtitle: "Bill hopper and chamber votes.",
  },
  {
    href: "/oval",
    title: "Oval Office",
    subtitle: "Sign, veto, appoint.",
  },
  {
    href: "/directory",
    title: "Directory",
    subtitle: "Who holds which role.",
  },
];

export default async function BriefingPage() {
  // Redirect first-time users to the character setup screen. We do this here (not in a layout)
  // so /character itself isn't caught in a loop, and so unauthenticated visitors to / still see
  // the briefing stub if Supabase isn't configured.
  const supabase = await tryCreateClient();
  let moments: Awaited<ReturnType<typeof fetchBriefingMoments>> = [];
  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("party")
        .eq("id", user.id)
        .maybeSingle();
      // Party is null on freshly-created profiles and becomes non-null the moment the user saves
      // the character form (the form defaults to "independent"). Senators / presidents don't need
      // a home district, so we don't gate on that.
      if (!profile?.party) {
        redirect("/character");
      }
      moments = await fetchBriefingMoments(supabase, user.id);
    }
  }

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--psc-ink)]">Home</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--psc-muted)]">
          Your inbox highlights wins and milestones. Below that, jump into any module.
        </p>
      </header>

      <BriefingInbox moments={moments} />

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">Modules</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {TILES.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="flex h-full flex-col justify-between rounded border border-[var(--psc-border)] bg-[var(--psc-panel)] p-4 transition hover:border-[var(--psc-accent)] hover:shadow"
          >
            <p className="text-base font-semibold text-[var(--psc-ink)]">{t.title}</p>
            <p className="mt-2 text-sm text-[var(--psc-muted)]">{t.subtitle}</p>
          </Link>
        ))}
        </div>
      </section>
    </div>
  );
}
