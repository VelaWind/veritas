import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import type { ZodError } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AgentKind, AgentScopes, AgentStatus } from "@/types/domain";

/** §6: every handler returns a `{ data, error }` envelope. */
export function apiData<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ data, error: null }, init);
}

export function apiError(error: string, status = 400) {
  return NextResponse.json({ data: null, error }, { status });
}

/**
 * AUDIT.md F-09, mitigation M2. Thrown from inside an `unstable_cache` callback
 * to stop an empty payload being STORED — throwing is the only way to tell
 * `unstable_cache` not to persist a value.
 *
 * The caller catches it and answers from an uncached read, so an empty result is
 * still *served*; it is only refused entry to the cache. That distinction is
 * what keeps a fresh pre-seed database rendering empty instead of erroring.
 */
export class EmptyPayloadError extends Error {
  constructor(where: string) {
    super(`Refusing to cache an empty ${where} payload.`);
    this.name = "EmptyPayloadError";
  }
}

export function apiZodError(err: ZodError) {
  const detail = err.issues
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  return apiError(`Validation failed — ${detail}`, 422);
}

/**
 * Auth gate 2 of §4.2 (the handler role check; middleware is gate 1, RLS is
 * gate 3). Returns a session-bound client so the subsequent write runs under
 * the admin's JWT and is attributed in the audit trail.
 */
export async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false as const, response: apiError("Authentication required.", 401) };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "admin") {
    return { ok: false as const, response: apiError("Admin role required.", 403) };
  }

  return { ok: true as const, supabase, user };
}

/**
 * Like requireAdmin, but admits 'researcher' as well as 'admin' (Post-1.0
 * Phase A). Used by the suggestion-queue propose path: contributors may write
 * ONLY into `suggestions` (RLS-gated to their own pending rows), never to the
 * knowledge tables. Returns a session-bound client carrying the user's JWT so
 * the insert runs under their identity and RLS.
 */
export async function requireContributor() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false as const, response: apiError("Authentication required.", 401) };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || (profile.role !== "researcher" && profile.role !== "admin")) {
    return {
      ok: false as const,
      response: apiError("Researcher or admin role required.", 403),
    };
  }

  return { ok: true as const, supabase, user, role: profile.role as "researcher" | "admin" };
}

/**
 * Auth gate for the agent propose path (Post-1.0 Phase B). Agents are
 * server-to-server: they authenticate with a SCOPED BEARER TOKEN (not a Supabase
 * session, never the service key), accepted ONLY here. The plaintext token is
 * hashed and matched against `agent_tokens`; a valid, unexpired, unrevoked token
 * on an enabled agent resolves to that agent's identity.
 *
 * Returns the service-role client to perform the insert: the agent has no
 * session, so the route stamps `proposed_by = agent.profile_id`,
 * `actor_type='agent'`, `agent_name = agent.name`, `status='pending'` itself —
 * capability-narrow. RLS is bypassed, but the authoritative server-side caps
 * (`enforce_agent_quota` BEFORE INSERT trigger) and every epistemic constraint
 * at approval still bind. An agent can never approve (apply_suggestion requires
 * is_admin()).
 */
export async function requireAgent(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return {
      ok: false as const,
      response: apiError("Agent bearer token required.", 401),
    };
  }

  const tokenHash = createHash("sha256").update(match[1].trim()).digest("hex");
  const supabase = createAdminClient();

  const { data: token, error } = await supabase
    .from("agent_tokens")
    .select("id, expires_at, revoked_at, agent:agents(id, name, kind, status, profile_id, enabled, scopes, trust)")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error) {
    return { ok: false as const, response: apiError("Token lookup failed.", 500) };
  }
  if (!token) {
    return { ok: false as const, response: apiError("Invalid agent token.", 401) };
  }
  if (token.revoked_at) {
    return { ok: false as const, response: apiError("Agent token revoked.", 401) };
  }
  if (token.expires_at && new Date(token.expires_at).getTime() <= Date.now()) {
    return { ok: false as const, response: apiError("Agent token expired.", 401) };
  }

  // PostgREST returns the embedded to-one relation as an object (or array under
  // some configs) — normalize.
  const agentRaw = Array.isArray(token.agent) ? token.agent[0] : token.agent;
  const agent = agentRaw as
    | {
        id: string;
        name: string;
        // Phase D: the lane the agent belongs to. The propose route requires a
        // skeptic critique from `research` agents specifically (§D.2).
        kind: AgentKind;
        status: AgentStatus;
        profile_id: string;
        enabled: boolean;
        scopes: AgentScopes;
        trust: number;
      }
    | undefined;
  if (!agent) {
    return { ok: false as const, response: apiError("Token is not bound to an agent.", 401) };
  }
  if (!agent.enabled) {
    return { ok: false as const, response: apiError(`Agent "${agent.name}" is disabled.`, 403) };
  }

  // Best-effort last-used stamp (never blocks the request).
  await supabase
    .from("agent_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", token.id);

  return { ok: true as const, supabase, agent };
}

/** Friendly translation of the DB epistemic-guard errors (§2.3/§2.6). */
export function translateDbError(message: string): string {
  if (message.includes("epistemics_consistent")) {
    return "Rejected by the database epistemic guard: that confidence is outside the permitted band for the chosen status.";
  }
  if (message.includes("rationale")) {
    return message; // trigger messages are already human-readable
  }
  if (message.includes("duplicate key")) {
    return "A record with that identifier (slug or link) already exists.";
  }
  return message;
}
