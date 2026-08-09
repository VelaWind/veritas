import type { SupabaseClient } from "@supabase/supabase-js";
import type { SuggestionStatus, SuggestionWithProposer } from "@/types/domain";
import { logQueryError, logQueryThrow } from "./log";

// Two FKs point at profiles (proposed_by, reviewed_by) so the embed must name
// the constraint explicitly, or PostgREST cannot disambiguate.
// The skeptic's critique travels WITH the proposal (§D.2): a reviewer must see
// the objection and the claim together, not have to go looking for one.
const EMBED = `*, proposer:profiles!suggestions_proposed_by_fkey(display_name, role),
  critiques:suggestion_critiques(critic_name, verdict, body, findings, created_at)`;

/**
 * Suggestions are never public. Always read with a cookie-bound client so RLS
 * applies: a contributor sees only their own rows; an admin sees all.
 */
export async function listSuggestions(
  client: SupabaseClient,
  opts: { status?: SuggestionStatus; mine?: string } = {},
): Promise<SuggestionWithProposer[]> {
  try {
    let query = client.from("suggestions").select(EMBED);
    if (opts.status) query = query.eq("status", opts.status);
    if (opts.mine) query = query.eq("proposed_by", opts.mine);
    const { data, error } = await query.order("created_at", { ascending: false });
    if (error) return logQueryError("listSuggestions", error, []);
    return (data ?? []) as unknown as SuggestionWithProposer[];
  } catch (err) {
    return logQueryThrow("listSuggestions", err, []);
  }
}

export async function getSuggestion(
  client: SupabaseClient,
  id: string,
): Promise<SuggestionWithProposer | null> {
  try {
    const { data, error } = await client
      .from("suggestions")
      .select(EMBED)
      .eq("id", id)
      .maybeSingle();
    if (error) return logQueryError("getSuggestion", error, null);
    return (data as unknown as SuggestionWithProposer) ?? null;
  } catch (err) {
    return logQueryThrow("getSuggestion", err, null);
  }
}
