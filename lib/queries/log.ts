import type { PostgrestError } from "@supabase/supabase-js";

/**
 * Centralized query-layer error logging. The query functions intentionally
 * return safe empties so `next build` (which prerenders ISR pages) succeeds
 * with no database — but a real runtime error (e.g. the 42501 GRANT bug that
 * shipped silently) must NOT be invisible. This logs to the server console
 * (Vercel function logs) and returns the fallback so callers stay unchanged.
 *
 * Server-side only: query modules are imported by RSC/route handlers.
 */
export function logQueryError<T>(
  where: string,
  error: PostgrestError | { message?: string; code?: string } | null,
  fallback: T,
): T {
  if (error) {
    const code = "code" in error && error.code ? ` [${error.code}]` : "";
    const message = error.message ?? String(error);
    console.error(`[veritas:query:${where}]${code} ${message}`);
  }
  return fallback;
}

/** For the catch branch — a thrown exception rather than a Postgrest error. */
export function logQueryThrow<T>(where: string, err: unknown, fallback: T): T {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[veritas:query:${where}] threw: ${message}`);
  return fallback;
}
