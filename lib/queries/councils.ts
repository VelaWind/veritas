import type { SupabaseClient } from "@supabase/supabase-js";
import type { Council, CouncilTurn, CouncilWithTurns } from "@/types/domain";
import { logQueryError, logQueryThrow } from "./log";

/**
 * Council transcripts (§D.3, migration 0010).
 *
 * `councils` and `council_turns` are public-read by design — the deliberation is
 * the transparency artifact of Phase D. Nothing here touches `suggestions`: a
 * council's verdict is a proposal like any other and stays out of public view
 * until a human accepts it (§D.7).
 */

export async function getCouncil(
  client: SupabaseClient,
  id: string,
): Promise<CouncilWithTurns | null> {
  try {
    const { data, error } = await client
      .from("councils")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) return logQueryError("getCouncil", error, null);
    if (!data) return null;

    const { data: turns, error: turnsError } = await client
      .from("council_turns")
      .select("*")
      .eq("council_id", id)
      .order("round")
      .order("seq");
    // Not degraded to an empty transcript: a council page whose turns failed to
    // load would render as "a council that argued nothing", which is a claim
    // about the debate rather than about the query. logQueryError throws on a
    // live database, so this reaches the error boundary instead.
    if (turnsError) return logQueryError("getCouncil:turns", turnsError, null);

    return { ...(data as Council), turns: (turns ?? []) as CouncilTurn[] };
  } catch (err) {
    return logQueryThrow("getCouncil", err, null);
  }
}

/** Ids for generateStaticParams. Only councils that actually have a transcript. */
export async function listCouncilIds(client: SupabaseClient): Promise<string[]> {
  try {
    const { data, error } = await client
      .from("councils")
      .select("id")
      .neq("status", "running")
      .order("started_at", { ascending: false })
      .limit(200);
    if (error) return logQueryError("listCouncilIds", error, []);
    return ((data ?? []) as Array<{ id: string }>).map((c) => c.id);
  } catch (err) {
    return logQueryThrow("listCouncilIds", err, []);
  }
}

/**
 * Councils convened on one subject, for the "this claim has been debated" link
 * on a hypothesis or question page.
 */
export async function councilsForSubject(
  client: SupabaseClient,
  subjectId: string,
): Promise<Council[]> {
  try {
    const { data, error } = await client
      .from("councils")
      .select("*")
      .eq("subject_id", subjectId)
      .order("started_at", { ascending: false });
    if (error) return logQueryError("councilsForSubject", error, []);
    return (data ?? []) as Council[];
  } catch (err) {
    return logQueryThrow("councilsForSubject", err, []);
  }
}
