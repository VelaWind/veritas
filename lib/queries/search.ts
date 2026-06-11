import type { SupabaseClient } from "@supabase/supabase-js";
import type { SearchResult } from "@/types/domain";
import { logQueryError, logQueryThrow } from "./log";

export async function globalSearch(
  client: SupabaseClient,
  q: string,
  limit = 20,
): Promise<SearchResult[]> {
  try {
    const { data, error } = await client.rpc("global_search", { q, lim: limit });
    if (error) return logQueryError("globalSearch", error, []);
    return (data ?? []) as SearchResult[];
  } catch (err) {
    return logQueryThrow("globalSearch", err, []);
  }
}
