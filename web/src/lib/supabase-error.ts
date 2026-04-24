import type { PostgrestError } from "@supabase/supabase-js";

/** Throws `Error` with the PostgREST message when `error` is non-null. */
export function throwIfPostgrestError(error: PostgrestError | null): asserts error is null {
  if (error) throw new Error(error.message);
}
