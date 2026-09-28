// Transport for the agent runners.
//
// Least privilege: the runner holds ONLY the public anon key (for grounding
// context reads — exactly what a visitor can see) and a scoped agent bearer
// token (for proposing). It never touches the service-role key. Proposals go
// through the public HTTP route, so the runner exercises the same path a human
// contributor does.

/** Cookieless anon client for public reads (RLS applies — drafts stay hidden). */
export async function makeAnonClient(url, anonKey) {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Days-left threshold below which a preflight WARNS, on a passing token. */
export const EXPIRY_WARN_DAYS = 14;

/**
 * AUDIT F-14 — resolve the token BEFORE any model work, and refuse to start if
 * it cannot post. Calls GET /api/agent/whoami, which runs the same
 * requireAgent() as the propose route, so the verdict here is the verdict the
 * route would give — just delivered before the model time instead of after it.
 *
 * Returns { ok: true, agent, warning? } or { ok: false, reason }. `reason` is
 * written to be the run's last line, so it names the cause: "expired", not
 * "failed".
 */
export async function preflightToken(baseUrl, token) {
  let res;
  try {
    res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/agent/whoami`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    return { ok: false, reason: `cannot reach ${baseUrl} to check the token (${err.cause?.code ?? err.message}). Nothing could be posted; not starting.` };
  }
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON error body */
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, reason: `token refused (${res.status}): ${json?.error ?? "no message"}` };
  }
  if (res.status !== 200 || !json?.data) {
    return { ok: false, reason: `token check failed (HTTP ${res.status}${res.status === 404 ? " — this server predates /api/agent/whoami" : ""}): ${json?.error ?? "no message"}` };
  }
  const agent = json.data;
  if (!agent.may_propose) {
    return { ok: false, reason: `agent "${agent.name}" is kind '${agent.kind}', which the propose route refuses. Every proposal would be a 403; not starting.` };
  }
  const warning =
    agent.expires_in_days !== null && agent.expires_in_days < EXPIRY_WARN_DAYS
      ? `token for "${agent.name}" expires ${agent.expires_at} (${agent.expires_in_days} day(s)). Re-mint: node scripts/mint-agent-token.mjs --name ${agent.name} --expires-days 90`
      : null;
  return { ok: true, agent, warning };
}

/**
 * A propose response that means THE CREDENTIAL is dead, not this item. Returns a
 * stop reason, or null for a per-item outcome.
 *
 * 401 is always credential-level: invalid, expired or revoked. A 403 is
 * credential-level only when requireAgent says the agent is disabled (suspended
 * mid-run); other 403s are the quota trigger's per-item scope refusal, and must
 * keep being per-item. 429 is handled by the callers as a cap, as before.
 */
export function credentialStop(res) {
  if (res.status === 401) {
    const why = /expired/i.test(res.error ?? "") ? "token expired" : /revoked/i.test(res.error ?? "") ? "token revoked" : "token rejected";
    return `${why} (401): ${res.error ?? "no message"}`;
  }
  if (res.status === 403 && /is disabled/i.test(res.error ?? "")) {
    return `agent disabled (403): ${res.error}`;
  }
  return null;
}

/** POST one suggestion to the agent propose endpoint with the scoped token. */
export async function propose(baseUrl, token, envelope) {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/agent/suggestions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(envelope),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON error body */
  }
  return {
    status: res.status,
    data: json?.data ?? null,
    error: json?.error ?? null,
  };
}
