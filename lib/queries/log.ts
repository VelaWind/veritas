import type { PostgrestError } from "@supabase/supabase-js";
import { HAS_LIVE_SUPABASE } from "@/lib/supabase/env";

/**
 * Raised when a query fails against a database we *do* have credentials for.
 * Distinct type so `logQueryThrow` can re-throw it without logging it twice
 * when it passes back out through a caller's own `catch`.
 */
export class QueryFailedError extends Error {
  constructor(where: string, detail: string) {
    super(`Query "${where}" failed against the live database: ${detail}`);
    this.name = "QueryFailedError";
  }
}

/**
 * Centralized query-layer error handling.
 *
 * The safe-empty fallback exists so `next build` (which prerenders ISR pages)
 * succeeds with no database. That is correct when there is no database
 * configured — and wrong when there is one and it did not answer, because a
 * failed query and an empty table then render the identical page. That is how
 * a two-month outage stayed invisible: `[veritas:query:listTimeline] TypeError:
 * fetch failed` once per request, every page HTTP 200 and empty.
 *
 * So the fallback is gated on the state it was designed for:
 *   - no live credentials  → log, return the fallback, render the empty state
 *   - live credentials     → log, then throw; the error boundary says so
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
    if (HAS_LIVE_SUPABASE) throw new QueryFailedError(where, `${code} ${message}`.trim());
  }
  return fallback;
}

/** For the catch branch — a thrown exception rather than a Postgrest error. */
export function logQueryThrow<T>(where: string, err: unknown, fallback: T): T {
  // Already logged and classified by logQueryError on the way out; don't
  // double-log it just because the call site wraps its own body in try/catch.
  if (err instanceof QueryFailedError) throw err;

  const message = err instanceof Error ? err.message : String(err);
  console.error(`[veritas:query:${where}] threw: ${message}`);
  if (HAS_LIVE_SUPABASE) throw new QueryFailedError(where, message);
  return fallback;
}
