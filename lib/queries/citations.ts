import type { SupabaseClient } from "@supabase/supabase-js";
import type { CitationCheck } from "@/types/domain";
import { logQueryError, logQueryThrow } from "./log";

/**
 * Citation checks are keyed on the citation itself (§D.5a), so a result stored
 * when a proposal was verified is found again from the approved evidence page
 * with no hand-off and no change to apply_suggestion().
 *
 * Public: `citation_checks` carries a `for select using (true)` policy, because
 * it is a fact about a public citation rather than about unreviewed content.
 */
export async function getCitationCheck(
  client: SupabaseClient,
  key: string | null,
): Promise<CitationCheck | null> {
  if (!key) return null;
  try {
    const { data, error } = await client
      .from("citation_checks")
      .select("*")
      .eq("citation_key", key)
      .maybeSingle();
    if (error) return logQueryError("getCitationCheck", error, null);
    return (data as CitationCheck) ?? null;
  } catch (err) {
    return logQueryThrow("getCitationCheck", err, null);
  }
}
