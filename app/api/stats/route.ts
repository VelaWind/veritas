import { unstable_cache } from "next/cache";
import { apiData, EmptyPayloadError } from "@/lib/api";
import { publicClient } from "@/lib/supabase/public";
import { HAS_LIVE_SUPABASE } from "@/lib/supabase/env";
import { getDashboardStats } from "@/lib/queries/stats";

const readStats = () => getDashboardStats(publicClient);

const getCachedStats = unstable_cache(
  async () => {
    const stats = await readStats();
    // ── AUDIT.md F-09, M2 ────────────────────────────────────────────────────
    // `null` is exactly the payload the poisoning wrote. dashboard_stats is a
    // plain view (0015) and always returns one row against a live database, so
    // null here means no row came back at all — worth re-checking rather than
    // pinning for 15 minutes. Throwing is the only way to stop unstable_cache
    // storing it; the caller serves it uncached.
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
    // Empty is served, just never cached, so the page renders its empty state
    // rather than erroring.
    // Any other error (e.g. QueryFailedError) propagates and stays loud.
    if (err instanceof EmptyPayloadError) return apiData(await readStats());
    throw err;
  }
}

