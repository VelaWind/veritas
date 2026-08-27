// ─────────────────────────────────────────────────────────────────────────────
// The council lane (DECISIONS §D.3) — four roles, N rounds, in public.
//
// This module holds the two things that must be right independently of the
// runner: the CONTEXT BUDGET, and the role prompts.
//
// Why the budget is its own function rather than a few lines inside the loop:
// §D.3 requires reasoning chains to be shared BETWEEN rounds, and without a
// bound round 3 silently overflows a 32k local context. Postgres then stores a
// transcript in which the model demonstrably could not have seen the arguments
// it appears to be answering — which reads as reasoning and is not. A budget
// that lives in a loop is a budget nobody tests; this one is a pure function of
// (turns, budget) and is exercised directly.
// ─────────────────────────────────────────────────────────────────────────────

/** The four roles, in the order they speak within a round. */
export const COUNCIL_ROLES = ["advocate", "skeptic", "verifier", "synthesizer"];

export const COUNCIL_AGENT_NAME = "council";

/** Per-turn output cap (§D.3, "~400 tokens"). */
export const DEFAULT_MAX_TURN_TOKENS = 400;

/**
 * Default transcript budget, in estimated tokens.
 *
 * Sized against the smallest context this project actually targets (a 32k local
 * model): 6000 tokens of transcript leaves ample room for the system prompt, the
 * subject material, and the turn being generated. It is deliberately NOT set to
 * "as much as fits" — the point is that the bound is reached and recorded on a
 * long council, not that it never bites.
 */
export const DEFAULT_CONTEXT_BUDGET_TOKENS = 6000;

/** The marker that must appear in the prompt, and in the rendered transcript. */
export const TRUNCATION_MARKER = "[earlier turns truncated]";

/**
 * Token estimate: ~4 characters per token.
 *
 * Deliberately an ESTIMATE and named as one. A real tokenizer would be a new
 * dependency for the local model, would still be wrong for the cloud adapters
 * (different tokenizers), and would buy nothing: this is a safety margin, not an
 * accounting system. It errs high on prose (English averages nearer 4.5), which
 * is the correct direction for a cap.
 */
export function estimateTokens(text) {
  return Math.ceil(String(text ?? "").length / 4);
}

/** One prior turn, as the next round's prompt sees it. */
function renderTurn(turn) {
  const head = `--- round ${turn.round} · ${turn.role} ---`;
  const body = String(turn.content ?? "").trim();
  const why = String(turn.reasoning ?? "").trim();
  return why ? `${head}\n${body}\n\nREASONING: ${why}` : `${head}\n${body}`;
}

/**
 * Build the transcript a turn argues from, bounded by `budgetTokens`.
 *
 * Selection is NEWEST-FIRST (§D.3): when the budget binds, the arguments that
 * survive are the ones being answered right now, not the oldest ones. The
 * selected turns are then rendered in CHRONOLOGICAL order, because a debate read
 * backwards is not a debate.
 *
 * The newest turn is always included, even when it alone exceeds the budget. A
 * turn that cannot see the argument immediately before it is not participating
 * in a council, and returning an empty transcript would be a worse failure than
 * overshooting a soft cap by one turn. So this is a budget with a floor of one
 * turn, and that is stated rather than left for someone to discover from a
 * surprising prompt length.
 *
 * @returns {{text: string, truncated: boolean, included: number, omitted: number, tokens: number}}
 *   `truncated` is true iff at least one prior turn was DROPPED — it is the
 *   value written to council_turns.context_truncated.
 */
export function buildTranscriptContext(priorTurns, budgetTokens) {
  const turns = Array.isArray(priorTurns) ? priorTurns : [];
  if (turns.length === 0) {
    return { text: "", truncated: false, included: 0, omitted: 0, tokens: 0 };
  }

  const budget = Number.isFinite(budgetTokens) && budgetTokens > 0 ? budgetTokens : 0;
  const chosen = [];
  let used = 0;

  for (let i = turns.length - 1; i >= 0; i--) {
    const rendered = renderTurn(turns[i]);
    const cost = estimateTokens(rendered);
    const isNewest = chosen.length === 0;
    if (!isNewest && used + cost > budget) break;   // floor of one turn
    chosen.push({ index: i, rendered });
    used += cost;
  }

  chosen.reverse();                                  // back into reading order
  const omitted = turns.length - chosen.length;
  const truncated = omitted > 0;

  const body = chosen.map((c) => c.rendered).join("\n\n");
  const text = truncated
    ? `${TRUNCATION_MARKER} — ${omitted} earlier turn${omitted === 1 ? "" : "s"} ` +
      `omitted to stay within the context budget. You are seeing the most recent ` +
      `${chosen.length} of ${turns.length}.\n\n${body}`
    : body;

  return { text, truncated, included: chosen.length, omitted, tokens: used };
}

// ─── Role prompts ────────────────────────────────────────────────────────────
// Each role is given a job it can fail at. None of them can approve anything:
// the council's product is a transcript plus a verdict, and the verdict is a
// proposal that a human decides on.

const SHARED_RULES = `
Rules that bind every role:
- You are arguing about a claim on Veritas, an observatory of human knowledge. Nothing you say changes the map; a human reviews the council's verdict.
- Be specific and checkable. "The evidence is weak" is useless. "The cited result measures X under conditions Y, and the claim generalises to Z" is useful.
- Do not perform agreement. If you think the previous speaker was right, say which part and why, and say what is still unresolved.
- Keep to roughly 250 words. You are one turn in a debate, not the last word.

Output STRICT JSON ONLY — no prose outside it, no markdown fences:
{"content": "your turn, addressed to the other roles and to the public reader", "reasoning": "the chain that got you there — what you weighed, what you discarded, and why. This is fed to the next round, so make it usable rather than decorative."}`;

export const ROLE_SYSTEM = {
  advocate: `You are the ADVOCATE on a Veritas council.

Make the strongest honest case FOR the claim under debate. Strongest and honest are both binding: you are not a lawyer for a client, you are the reason the best version of this position gets heard before it is judged. State what the claim gets right, what would follow if it were true, and which evidence actually carries weight rather than merely being adjacent.

If the claim is weak, the strongest honest case may be narrow. Argue the narrow version rather than inflating the broad one — an advocate who overreaches hands the skeptic an easy win and teaches the reader nothing.
${SHARED_RULES}`,

  skeptic: `You are the SKEPTIC on a Veritas council.

Attack the claim, and attack the advocate's case for it. Find the weakest assumption the argument depends on — the single one that, if false, collapses it. Check whether the evidence supports the claim AS STATED or only something narrower. Check whether the confidence is earned rather than merely legal.

You cannot block anything. That is exactly why you should be uncompromising. But do not manufacture objections you do not believe: if a point held against your best attack, say so and say what you attacked. A tested claim that survives is worth more to a reader than an untested one.
${SHARED_RULES}`,

  verifier: `You are the VERIFIER on a Veritas council.

You do not argue for or against the claim. You audit what the other roles have SAID against what is actually established. Your questions: has anyone asserted a fact that is not in evidence? Has a citation been described as showing more than it shows? Has a contested question been treated as settled by either side?

Report what you can and cannot check. "I cannot verify this from what has been presented" is a real and useful finding — much better than a guess dressed as a check. Where the two sides are using a term differently, say so; a great deal of apparent disagreement is that.
${SHARED_RULES}`,

  synthesizer: `You are the SYNTHESIZER on a Veritas council.

Say where the debate actually stands after this round. What is agreed, what is genuinely contested, and what would have to be shown to move anyone.

You are NOT a judge and there is no casting vote. Do not split the difference, do not declare a winner, and do not manufacture a consensus that the turns above do not support. If the roles are apart, your job is to state the disagreement precisely enough that a reader can see what is at stake in it.
${SHARED_RULES}`,
};

/**
 * The final call: one synthesis over the whole council, producing the verdict,
 * the per-role vote, and the outcome.
 *
 * `outcome` has no majority-wins path (§D.3). A 2-2 split is a RESULT, recorded
 * as `split` with each role's final position, and the write-up is asked for what
 * each side would need to SEE — not for a winner. `no_verdict` is an honest
 * answer, not a failure to produce one.
 */
export const SYNTHESIS_SYSTEM = `You are the SYNTHESIZER closing a Veritas council. You are writing the public verdict.

Read the whole transcript and report what the council produced. You are not a judge: there is no majority rule and no casting vote here.

Choose "outcome":
- "consensus" — the roles converged. Only if they actually did; near-agreement with a live objection is not consensus.
- "split" — they did not converge. This is a RESULT, not a failure. Record each side as its holder would state it, and write what each side would need to SEE to change its mind. Do NOT pick a winner.
- "no_verdict" — the debate did not get far enough to support either of the above. An honest empty answer is worth more than a manufactured one.

"vote" records each role's FINAL position in one sentence, in that role's own voice.

"verdict" is the public write-up, 150-300 words, addressed to a reader who has not read the transcript. Every claim in it must be traceable to a turn someone took — the transcript is public, and a verdict that does not follow from it is the one thing that would make this exercise theatre.

Output STRICT JSON ONLY — no prose outside it, no markdown fences:
{"outcome": "consensus" | "split" | "no_verdict",
 "vote": {"advocate": "...", "skeptic": "...", "verifier": "...", "synthesizer": "..."},
 "verdict": "..."}`;

export const COUNCIL_OUTCOMES = new Set(["consensus", "split", "no_verdict"]);

/**
 * Validate a synthesis response. Returns `{ ok: false, reason }` rather than
 * throwing, so the runner can record an honest `no_verdict` instead of dying
 * with a complete transcript already written and nothing to show for it.
 */
export function validateSynthesis(obj) {
  if (!obj || typeof obj !== "object") return { ok: false, reason: "synthesis was not JSON" };
  if (!COUNCIL_OUTCOMES.has(obj.outcome)) {
    return { ok: false, reason: `outcome "${obj.outcome}" is not one of consensus|split|no_verdict` };
  }
  const verdict = String(obj.verdict ?? "").trim();
  if (!verdict) return { ok: false, reason: "verdict text was empty" };

  const vote = {};
  if (obj.vote && typeof obj.vote === "object") {
    for (const role of COUNCIL_ROLES) {
      const v = String(obj.vote[role] ?? "").trim();
      if (v) vote[role] = v.slice(0, 1000);
    }
  }
  return { ok: true, outcome: obj.outcome, verdict: verdict.slice(0, 8000), vote };
}

/** The user-side prompt for one turn. */
export function turnPrompt({ subject, transcript, round, totalRounds, role }) {
  const parts = [
    `CLAIM UNDER DEBATE`,
    subject,
    ``,
    `You are the ${role.toUpperCase()}, speaking in round ${round} of ${totalRounds}.`,
  ];
  if (transcript) {
    parts.push(
      ``,
      `TRANSCRIPT SO FAR (read it — you are answering these turns, not speaking into a vacuum):`,
      transcript,
    );
  } else {
    parts.push(``, `You are opening the council. There are no prior turns.`);
  }
  return parts.join("\n");
}
