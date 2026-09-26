import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiData, apiError, apiZodError, requireAgent } from "@/lib/api";

/**
 * §D.4 — the Internal Affairs sanction endpoint. The ONLY route through which an
 * agent token can change another agent's status, and it is capability-narrow:
 * one action, one target, one reason, nothing else.
 *
 * WHY THE KIND CHECK IS HERE AND NOT IN THE FUNCTION. 0011's own header says it:
 * `ia_apply_sanction` is `security definer` and runs as `service_role`, so it
 * cannot see which token authenticated. It can enforce WHAT a sanction may be —
 * only 'throttle' or 'suspend', only strictly more restrictive, only with a
 * stated reason — but not WHO may ask for one. That half is this route's job,
 * after `requireAgent()` resolves the registry row. The two halves together are
 * the control; neither is sufficient alone.
 *
 * THE CAPABILITY CHECK RUNS BEFORE THE BODY IS PARSED, AND THAT ORDER IS
 * DELIBERATE. A caller without the capability must be refused for that reason
 * and no other — if validation ran first, a non-IA agent would learn whether its
 * body was well-formed before learning it had no business sending one, and a
 * malformed request from a non-IA agent would answer 422 as though the route
 * were open to it. It is rejected HERE, before anything reaches the database, so
 * no audit row and no status change can result from a caller that lacks the
 * kind.
 *
 * 403, not 401: the token is valid and the agent is real. What is missing is the
 * capability, not the credential.
 *
 * WHAT THIS ROUTE CANNOT DO, BY CONSTRUCTION. There is no `action: 'reinstate'`
 * to send — the function accepts two values and this schema accepts the same
 * two, so a reinstatement request cannot be spelled at either layer.
 * Reinstatement is admin-only and lives nowhere in the agent surface.
 */

const bodySchema = z.object({
  agent_name: z.string().trim().min(1).max(200),
  // The same two values the function accepts, named here so a request for
  // anything else is refused at the edge with a readable message rather than
  // arriving as a 22023 from Postgres. The function remains the authority; this
  // is not a substitute for it.
  action: z.enum(["throttle", "suspend"]),
  // A sanction without a stated reason is the soft-failure shape this repository
  // keeps a catalogue of. The function refuses an empty reason too; `min(3)`
  // here refuses a reason that is technically non-empty and says nothing.
  reason: z.string().trim().min(3).max(2000),
});

export async function POST(request: NextRequest) {
  const auth = await requireAgent(request);
  if (!auth.ok) return auth.response;

  // ── Capability gate. Before the body. See the header. ──────────────────────
  if (auth.agent.kind !== "internal_affairs") {
    return apiError(
      `Agent "${auth.agent.name}" is kind '${auth.agent.kind}'. Sanctions are an internal_affairs capability; ` +
        "a valid token for another lane is refused here, not at the database.",
      403,
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON body.", 400);
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return apiZodError(parsed.error);

  const { agent_name, action, reason } = parsed.data;

  // THE AUDITOR IS NOT EXEMPT (§D.4). There is deliberately no check that
  // `agent_name !== auth.agent.name`. IA may sanction itself: self-suspension is
  // fail-safe — it stops work and can corrupt nothing — and it cannot un-suspend
  // itself afterwards for the same reason nobody can, because the function has
  // no transition that reaches 'active'. Adding a self-exclusion here would make
  // the auditor the one identity on the roster it could not act on, which is the
  // opposite of the intent.
  const { data, error } = await auth.supabase
    .rpc("ia_apply_sanction", {
      p_agent_name: agent_name,
      p_action: action,
      p_reason: reason,
    })
    .single();

  if (error) {
    // The function's own SQLSTATEs, mapped to what each one means to a caller:
    //   22023  invalid_parameter_value  — an action or reason the function will
    //                                     not accept (including 'reinstate').
    //   23514  check_violation          — a move that is not strictly more
    //                                     restrictive: loosening, or a no-op.
    //   P0002  no_data_found            — no agent by that name.
    // 409 for 23514 rather than 422: the request is well-formed and the refusal
    // is about the target's current state, which a retry after a state change
    // could legitimately resolve.
    const status =
      error.code === "P0002" ? 404 : error.code === "23514" ? 409 : error.code === "22023" ? 422 : 500;
    return apiError(error.message, status);
  }

  return apiData(data, { status: 200 });
}
