import { unstable_cache } from "next/cache";
import { revalidateTag } from "next/cache";
import { apiData, apiError, EmptyPayloadError, requireAdmin } from "@/lib/api";
import { publicClient } from "@/lib/supabase/public";
import { HAS_LIVE_SUPABASE } from "@/lib/supabase/env";
import { getDashboardStats } from "@/lib/queries/stats";

const readStats = () => getDashboardStats(publicClient);

const getCachedStats = unstable_cache(
  async () => {
    const stats = await readStats();
    // ── AUDIT.md F-09, M2 ────────────────────────────────────────────────────
    // `null` is exactly the payload the poisoning wrote. It also means "the
    // materialized view has never been refreshed", which is a state worth
    // re-checking rather than pinning for 15 minutes. Throwing is the only way
    // to stop unstable_cache storing it; the caller serves it uncached.
    if (stats === null) throw new EmptyPayloadError("dashboard stats");
    return stats;
  },
  ["dashboard-stats"],
  { revalidate: 900, tags: ["stats"] }, // §1.3: dashboard refreshes every 15 min
);

export async function GET() {
  // ── AUDIT.md F-09, M1 ──────────────────────────────────────────────────────
  // No credentials → the query layer returns its empty fallback instead of
  // throwing, and the cache key records nothing about credentials, so that
  // fallback would be stored under the healthy key and served later by a
  // credentialed server. Do not let it reach the cache at all.
  if (!HAS_LIVE_SUPABASE) return apiData(await readStats());

  try {
    return apiData(await getCachedStats());
  } catch (err) {
    // Empty is served, just never cached — a fresh database whose matview has
    // not been refreshed still renders its empty state rather than erroring.
    // Any other error (e.g. QueryFailedError) propagates and stays loud.
    if (err instanceof EmptyPayloadError) return apiData(await readStats());
    throw err;
  }
}

/**
 * Admin-only refresh of the §2.10 materialized view ("route handler calls
 * rpc"). Not in the §6 table, but required by §2.10's refresh strategy.
 */
export async function POST() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { error } = await auth.supabase.rpc("refresh_dashboard_stats");
  if (error) return apiError(error.message, 500);

  revalidateTag("stats");
  const stats = await readStats();
  return apiData(stats);
}
