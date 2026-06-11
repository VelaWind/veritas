import { unstable_cache } from "next/cache";
import { revalidateTag } from "next/cache";
import { apiData, apiError, requireAdmin } from "@/lib/api";
import { publicClient } from "@/lib/supabase/public";
import { getDashboardStats } from "@/lib/queries/stats";

const getCachedStats = unstable_cache(
  () => getDashboardStats(publicClient),
  ["dashboard-stats"],
  { revalidate: 900, tags: ["stats"] }, // §1.3: dashboard refreshes every 15 min
);

export async function GET() {
  const stats = await getCachedStats();
  return apiData(stats);
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
  const stats = await getDashboardStats(publicClient);
  return apiData(stats);
}
