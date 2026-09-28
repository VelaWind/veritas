import type { NextRequest } from "next/server";
import {
  apiData,
  apiError,
  apiZodError,
  MAY_PROPOSE,
  requireAgent,
  translateDbError,
} from "@/lib/api";
import type { z } from "zod";
import {
  agentCritiqueSchema,
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
/**
 * §D.4 / AUDIT F-13 — WHICH LANES MAY PROPOSE AT ALL.
 *
 * AN ALLOW-LIST, NOT A DENY-LIST OF `internal_affairs`, and the difference is the
 * whole point. A deny-list closes exactly the hole that was found and silently
 * admits every `agent_kind` added after it — the enum already carries six values
 * and will carry more. This list has to be edited deliberately to widen, and the
 * edit is the decision.
 *
 * `research` proposes; that is the lane's purpose. `council` is here BEFORE it
 * needs to be: stage 3 stops short of the queue on purpose (`councils.suggestion_id`
 * stays null), and when the verdict is wired it posts through this route as
 * itself so `enforce_agent_quota()` finds it by `profile_id` and caps it like any
 * other proposer. Omitting it now would make that wiring look like a bug here.
 *
 * `skeptic` and `verifier` are absent because they cannot reach this code at all,
 * not because they are refused: both run INSIDE the research lane — the research
 * runner makes their model calls and attributes the output to them by id — so
 * `seed-agent-roster.mjs` mints them no token (`NEEDS_TOKEN`). Stated rather than
 * left to be inferred from the omission.
 *
 * `contradiction` is also absent, and that one IS a live decision rather than a
 * moot point: no contradiction agent is on the roster today. If one is added with
 * a token, it will be refused here until this list says otherwise — which is the
 * allow-list working, not failing.
 *
 * WHAT THIS CLOSES. AUDIT F-13: an `internal_affairs` token reached this route and
 * landed a `pending` suggestion (201), contradicting §D.4's "IA … cannot touch a
 * knowledge table, `scopes`, `trust`, or `suggestions`". 0011's own claim was
 * always true — nothing in that migration reaches `suggestions` — but IA's token
 * reached a different route, which no migration could constrain.
 *
 * It also closes a second, older one, recorded in DECISIONS under *Council
 * identity* → "Correction to the pre-push note" and left unfixed there: IA's
 * token is UNSCOPED (`scopes.domains: []`, the oversight default since
 * 2026-08-11), and an unscoped token skips the domain branch of
 * `enforce_agent_quota()` entirely (`if jsonb_array_length(v_domains) > 0`), so
 * "IA could in principle propose in any domain". That was unexercised rather than
 * unreachable. It is unreachable now: IA does not get past this check, so the
 * missing domain branch behind it no longer has a caller.
 *
 * The check runs BEFORE the body is parsed, for the same reason the sanction
 * route's does: a lane that may not propose must be refused for that reason and
 * no other, and a malformed body from such a caller must not answer 422 as though
 * the route were open to it.
 *
 * 403, not 401: the token is valid and the agent is real. The capability is
 * absent, not the credential.
 *
 * `MAY_PROPOSE` itself is defined in lib/api.ts, so that GET /api/agent/whoami
 * reports this same list to a runner's preflight rather than a copy of it.
 */

export async function POST(request: NextRequest) {
  const auth = await requireAgent(request);
  if (!auth.ok) return auth.response;

  if (!MAY_PROPOSE.has(auth.agent.kind)) {
    return apiError(
      `Agent "${auth.agent.name}" is kind '${auth.agent.kind}', which does not propose. ` +
        `Proposing is limited to: ${[...MAY_PROPOSE].sort().join(", ")}.`,
      403,
    );
  }

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

  // D.2 — the skeptic lane is always on for research agents. A research proposal
  // arrives with its strongest objection already attached or it does not arrive.
  //
  // The other lane that reaches this point is `council`, and it is not critiqued:
  // a council transcript already contains a skeptic turn, so requiring a separate
  // critique would ask it to re-argue what it just argued. (This comment used to
  // read "contradiction findings, IA" — IA can no longer reach this code at all;
  // see MAY_PROPOSE above and AUDIT F-13.)
  const rawCritique = (body as { critique?: unknown }).critique;
  let critique: z.infer<typeof agentCritiqueSchema> | null = null;
  if (rawCritique !== undefined && rawCritique !== null) {
    const parsed = agentCritiqueSchema.safeParse(rawCritique);
    if (!parsed.success) return apiZodError(parsed.error);
    critique = parsed.data;
  }
  if (auth.agent.kind === "research" && !critique) {
    return apiError(
      "A research proposal must carry a skeptic critique. The skeptic lane is not optional.",
      422,
    );
  }

  // Written together in one transaction when there is a critique, so the queue
  // never shows an uncritiqued proposal (§D.2). The function still inserts
  // through the enforce_agent_quota trigger, so every cap and scope check
  // applies exactly as it does below — and it hard-codes status 'pending', so a
  // critique can never influence the outcome.
  const { data, error } = critique
    ? await auth.supabase
        .rpc("propose_with_critique", {
          p_target_type: target_type,
          p_operation: operation,
          p_target_id: target_id ?? null,
          p_payload: parsedPayload.data,
          p_rationale: rationale,
          p_proposed_by: auth.agent.profile_id,
          p_agent_name: auth.agent.name,
          p_critic_name: critique.critic_name,
          p_verdict: critique.verdict,
          p_body: critique.body,
          p_findings: critique.findings,
        })
        .single()
    : await auth.supabase
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
    const status =
      error.code === "53400" ? 429 : error.code === "42501" ? 403 : 409;

    // D.4 check #3 — the quota trigger RAISES, so a refusal leaves no row behind
    // and would be invisible to a later audit. Record it. Best-effort: a failed
    // audit write must never change the answer the agent gets.
    if (status === 429 || status === 403) {
      await auth.supabase
        .from("agent_incidents")
        .insert({
          agent_id: auth.agent.id,
          agent_name: auth.agent.name,
          kind: status === 429 ? "cap_exceeded" : "scope_denied",
          sqlstate: error.code ?? "",
          detail: error.message.slice(0, 500),
        })
        .then(undefined, () => undefined);
    }
    return apiError(translateDbError(error.message), status);
  }
  return apiData(data, { status: 201 });
}
