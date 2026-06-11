import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContradictionWithPartners } from "@/types/domain";
import { logQueryError, logQueryThrow } from "./log";

const EMBED = `*,
  a:hypotheses!contradictions_hypothesis_a_fkey(id, slug, title, status),
  b:hypotheses!contradictions_hypothesis_b_fkey(id, slug, title, status)`;

export async function listContradictions(
  client: SupabaseClient,
  opts: { resolved?: boolean } = {},
): Promise<ContradictionWithPartners[]> {
  try {
    let query = client.from("contradictions").select(EMBED);
    if (opts.resolved !== undefined) query = query.eq("resolved", opts.resolved);
    const { data, error } = await query.order("created_at", { ascending: false });
    if (error) return logQueryError("listContradictions", error, []);
    return (data ?? []) as unknown as ContradictionWithPartners[];
  } catch (err) {
    return logQueryThrow("listContradictions", err, []);
  }
}

export async function contradictionsForHypothesis(
  client: SupabaseClient,
  hypothesisId: string,
): Promise<ContradictionWithPartners[]> {
  try {
    const { data, error } = await client
      .from("contradictions")
      .select(EMBED)
      .or(`hypothesis_a.eq.${hypothesisId},hypothesis_b.eq.${hypothesisId}`)
      .order("resolved", { ascending: true })
      .order("created_at", { ascending: false });
    if (error) return logQueryError("contradictionsForHypothesis", error, []);
    return (data ?? []) as unknown as ContradictionWithPartners[];
  } catch (err) {
    return logQueryThrow("contradictionsForHypothesis", err, []);
  }
}
