import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AgentProfile,
  AgentPublic,
  AgentPublicStats,
  TimelineEvent,
} from "@/types/domain";
import { logQueryError, logQueryThrow } from "./log";

/**
 * Public agent surfaces (Phase D §D.1).
 *
 * These read the `agent_public` / `agent_public_stats` VIEWS, never the `agents`
 * table — that table is admin-only under RLS and holds `scopes` and `trust`.
 * The views' fixed column lists are the security boundary, so nothing here can
 * widen what is public by changing a select.
 */

export async function listPublicAgents(
  client: SupabaseClient,
): Promise<AgentProfile[]> {
  try {
    const [agentsRes, statsRes] = await Promise.all([
      client.from("agent_public").select("*").order("kind").order("name"),
      client.from("agent_public_stats").select("*"),
    ]);

    if (agentsRes.error) return logQueryError("listPublicAgents", agentsRes.error, []);
    // Stats are supplementary: a roster with no counts is still worth showing,
    // so a stats failure logs and degrades rather than blanking the page.
    if (statsRes.error) logQueryError("listPublicAgents:stats", statsRes.error, null);

    const byName = new Map(
      ((statsRes.data ?? []) as AgentPublicStats[]).map((s) => [s.name, s]),
    );
    return ((agentsRes.data ?? []) as AgentPublic[]).map((a) => ({
      ...a,
      stats: byName.get(a.name) ?? null,
    }));
  } catch (err) {
    return logQueryThrow("listPublicAgents", err, []);
  }
}

export async function getPublicAgent(
  client: SupabaseClient,
  name: string,
): Promise<AgentProfile | null> {
  try {
    const { data, error } = await client
      .from("agent_public")
      .select("*")
      .eq("name", name)
      .maybeSingle();
    if (error) return logQueryError("getPublicAgent", error, null);
    if (!data) return null;

    const { data: stats, error: statsError } = await client
      .from("agent_public_stats")
      .select("*")
      .eq("name", name)
      .maybeSingle();
    if (statsError) logQueryError("getPublicAgent:stats", statsError, null);

    return { ...(data as AgentPublic), stats: (stats as AgentPublicStats) ?? null };
  } catch (err) {
    return logQueryThrow("getPublicAgent", err, null);
  }
}

export async function listPublicAgentNames(
  client: SupabaseClient,
): Promise<string[]> {
  try {
    const { data, error } = await client.from("agent_public").select("name");
    if (error) return logQueryError("listPublicAgentNames", error, []);
    return ((data ?? []) as Array<{ name: string }>).map((a) => a.name);
  } catch (err) {
    return logQueryThrow("listPublicAgentNames", err, []);
  }
}

/**
 * An agent's public activity is the TIMELINE, not the queue.
 *
 * `timeline_events` is already anon-readable and records what the agent actually
 * got *approved* into the map. Pending proposals stay invisible until a human
 * accepts one — publishing unreviewed work would make the map look like it
 * contains claims it does not (§D.7).
 */
export async function agentActivity(
  client: SupabaseClient,
  agentName: string,
  limit = 20,
): Promise<TimelineEvent[]> {
  try {
    const { data, error } = await client
      .from("timeline_events")
      .select("*")
      .eq("actor_type", "agent")
      .eq("agent_name", agentName)
      .order("id", { ascending: false })
      .limit(limit);
    if (error) return logQueryError("agentActivity", error, []);
    return (data ?? []) as TimelineEvent[];
  } catch (err) {
    return logQueryThrow("agentActivity", err, []);
  }
}
