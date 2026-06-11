import type { SupabaseClient } from "@supabase/supabase-js";
import type { DashboardStats } from "@/types/domain";

/**
 * Reads the §2.10 materialized view. Returns null when the view has never
 * been refreshed (or no DB is reachable) — callers render an empty state.
 */
export async function getDashboardStats(
  client: SupabaseClient,
): Promise<DashboardStats | null> {
  try {
    const { data, error } = await client
      .from("dashboard_stats")
      .select("*")
      .maybeSingle();
    if (error || !data) return null;
    return data as DashboardStats;
  } catch {
    return null;
  }
}
