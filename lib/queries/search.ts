import type { SupabaseClient } from "@supabase/supabase-js";
import type { SearchResult } from "@/types/domain";

export async function globalSearch(
  client: SupabaseClient,
  q: string,
  limit = 20,
): Promise<SearchResult[]> {
  try {
    const { data, error } = await client.rpc("global_search", { q, lim: limit });
    if (error) return [];
    return (data ?? []) as SearchResult[];
  } catch {
    return [];
  }
}
