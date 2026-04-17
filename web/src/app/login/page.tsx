import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SignInDiscord } from "@/components/sign-in-discord";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return (
      <div className="mx-auto max-w-lg px-6 py-16 text-sm text-red-700">
        Supabase environment variables are missing. Copy `web/.env.example` to
        `web/.env.local` and add your project keys before signing in.
      </div>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/");

  const params = await searchParams;

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-lg flex-col justify-center px-6">
      <div className="border border-[var(--psc-border)] bg-[var(--psc-panel)] p-8 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--psc-muted)]">
          Federal access gateway
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-[var(--psc-ink)]">
          PolSim Command Center
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--psc-muted)]">
          Sign in with Discord so the system can verify your server membership
          and attach your character to your account.
        </p>
        {params.error ? (
          <p className="mt-4 text-sm text-red-700">
            Authentication failed. Try again or check Supabase Discord provider
            settings.
          </p>
        ) : null}
        <div className="mt-8">
          <SignInDiscord />
        </div>
        <p className="mt-6 text-xs text-[var(--psc-muted)]">
          In Supabase: Auth → Providers → Discord. In the Discord app, set OAuth2
          redirect to{" "}
          <code className="font-mono break-all">
            https://&lt;your-project-ref&gt;.supabase.co/auth/v1/callback
          </code>{" "}
          using the same project ref as Project Settings → API → Project URL.
        </p>
        <Link
          href="/"
          className="mt-8 inline-block text-sm font-medium text-[var(--psc-accent)] underline-offset-4 hover:underline"
        >
          Return to briefing
        </Link>
      </div>
    </div>
  );
}
