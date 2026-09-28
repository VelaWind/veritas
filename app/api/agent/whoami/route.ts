import { apiData, MAY_PROPOSE, requireAgent } from "@/lib/api";

/**
 * AUDIT F-14 — the runner PREFLIGHT. Resolves the caller's own token and says
 * what it is, before the runner spends any model time.
 *
 * WHY THIS EXISTS. A research run with a dead token used to do all of its local
 * inference — a generation and a skeptic call per hypothesis, tens of minutes —
 * and only then discover, one 401 per item, that nothing it produced could be
 * posted. The run ended "N skipped", exit 0: a wrong credential producing a
 * plausible-looking success. The 401 was only where the failure SURFACED; the
 * waste was everything before it. A runner now calls this first and aborts,
 * naming the cause, if the answer is not 200.
 *
 * It goes through requireAgent(), the same function every agent route uses, so
 * "expired", "revoked", "invalid" and "disabled" come back with exactly the
 * status and message the propose route would have given — the preflight cannot
 * disagree with the route it stands in front of.
 *
 * `may_propose` reports the propose route's allow-list for this caller's kind,
 * so a token for a lane that cannot propose is also refused before the model
 * runs rather than after (403 on every item was the same waste).
 *
 * Read-only, and it reveals nothing the caller does not already hold: its own
 * agent's name, kind, status and its own token's expiry. It does count as use —
 * requireAgent stamps last_used_at — which is correct: the credential was
 * presented.
 */
export async function GET(request: Request) {
  const auth = await requireAgent(request);
  if (!auth.ok) return auth.response;

  const expiresAt = auth.token.expires_at;
  const msLeft = expiresAt ? new Date(expiresAt).getTime() - Date.now() : null;

  return apiData({
    name: auth.agent.name,
    kind: auth.agent.kind,
    status: auth.agent.status,
    may_propose: MAY_PROPOSE.has(auth.agent.kind),
    expires_at: expiresAt,
    expires_in_days: msLeft === null ? null : Math.floor(msLeft / 86_400_000),
  });
}
