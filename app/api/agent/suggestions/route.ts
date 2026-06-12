import type { NextRequest } from "next/server";
import {
  apiData,
  apiError,
  apiZodError,
  requireAgent,
  translateDbError,
} from "@/lib/api";
import {
  SUGGESTION_PAYLOAD_SCHEMAS,
  suggestionEnvelopeSchema,
} from "@/lib/validations";

/**
 * §Phase B: the AGENT propose endpoint. Authenticated by a scoped bearer token
 * (requireAgent), not a session. It validates the SAME envelope + payload
 * schemas a human proposal uses, applies agent-specific minimums (B.3 — required
 * justification, assumptions for a hypothesis), then inserts a `pending`
 * suggestion attributed to the agent. From here it is byte-identical to a human
 * proposal: same table, same apply_suggestion(), same epistemic constraints,
 * same audit trail — and a human admin must approve before anything goes live.
 *
 * Defense in depth: the `enforce_agent_quota` BEFORE INSERT trigger is the
 * authoritative cap (max_pending / max_per_hour / domain scope); a runaway
 * runner that ignores its client-side caps still cannot flood review.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAgent(request);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON body.", 400);
  }

  const env = suggestionEnvelopeSchema.safeParse(body);
  if (!env.success) return apiZodError(env.error);

  const { target_type, operation, target_id, payload, rationale } = env.data;
  const payloadSchema = SUGGESTION_PAYLOAD_SCHEMAS[target_type][operation];
  const parsedPayload = payloadSchema.safeParse(payload);
  if (!parsedPayload.success) return apiZodError(parsedPayload.error);

  // B.3 — required justification. An agent may not assert without a rationale,
  // and a proposed hypothesis must carry its assumptions (no "confident
  // assertion with no reasoning"). Humans are guided by the form; agents are
  // held to it here, before anything reaches the queue.
  if (rationale.trim() === "") {
    return apiError("An agent proposal must include a non-empty rationale.", 422);
  }
  if (target_type === "hypothesis" && operation === "create") {
    const assumptions = (parsedPayload.data as { assumptions?: unknown[] }).assumptions;
    if (!Array.isArray(assumptions) || assumptions.length === 0) {
      return apiError(
        "An agent-proposed hypothesis must state at least one assumption.",
        422,
      );
    }
  }

  const { data, error } = await auth.supabase
    .from("suggestions")
    .insert({
      target_type,
      operation,
      target_id: target_id ?? null,
      payload: parsedPayload.data,
      rationale,
      proposed_by: auth.agent.profile_id,
      actor_type: "agent",
      agent_name: auth.agent.name,
      status: "pending",
    })
    .select()
    .single();

  if (error) {
    // 53400 (configuration_limit_exceeded) → caps; 42501 → scope/identity.
    if (error.code === "53400") return apiError(translateDbError(error.message), 429);
    if (error.code === "42501") return apiError(translateDbError(error.message), 403);
    return apiError(translateDbError(error.message), 409);
  }
  return apiData(data, { status: 201 });
}
