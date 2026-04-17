/** Discord / Supabase Auth user_metadata keys vary by provider version. */

export function pickDiscordUsername(meta: Record<string, unknown> | null | undefined): string | null {
  if (!meta) return null;
  const v = (k: string) => {
    const x = meta[k];
    return typeof x === "string" && x.trim() ? x.trim() : null;
  };
  return (
    v("preferred_username") ??
    v("user_name") ??
    v("global_name") ??
    v("full_name") ??
    v("name") ??
    v("nickname") ??
    v("username") ??
    null
  );
}
