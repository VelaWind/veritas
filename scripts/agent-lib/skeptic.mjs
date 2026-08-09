// The skeptic lane (DECISIONS §D.2) — always on, never blocking.
//
// Every research proposal is attacked before a human sees it, and the objection
// travels with the proposal into the queue. The skeptic cannot reject anything:
// its output is an annotation, and a human decides. That is exactly why the
// prompt is uncompromising — an adversary with no power to block is free to be
// harsh, and a reviewer reading proposal-and-objection side by side is better
// informed than one reading either alone.
//
// Cost: ONE model call per proposal bundle (the hypothesis together with its
// evidence), not one per row. The call is charged to the SAME RunCaps budget as
// the research calls — the skeptic does not get its own allowance — which is why
// the --max-model-calls default was raised 8 → 16.

export const SKEPTIC_NAME = "skeptic";

const SKEPTIC_SYSTEM = `You are the Skeptic for Veritas, an observatory of human knowledge.

A research agent has drafted a proposal. Your job is to find what is WRONG with it, before a human reviewer sees it. You cannot block or reject anything — you annotate, and a human decides. Be uncompromising.

Attack in this order:
1. The weakest assumption the argument depends on. Which single assumption, if false, collapses the claim?
2. Whether the cited evidence supports the claim AS STATED, or only something narrower.
3. Whether the confidence is honest given what was actually shown — not whether it sits in the legal band, but whether it is earned.
4. Scope: does the claim quietly generalise beyond what its evidence covers?

Rules:
- "Looks reasonable" is not an output. Vague approval is a failure of your function.
- Do NOT manufacture objections you do not believe. If the proposal survives your best attack, return verdict "sound" and say what you attacked and why it held. A tested claim that holds is worth more to a reviewer than an untested one.
- Be specific and checkable. "The evidence is weak" is useless; "the cited study measures X in mice and the claim is about Y in humans" is useful.
- You are not told which agent wrote this, and you must not ask.

Output STRICT JSON ONLY — no prose, no markdown fences:
{
  "verdict": "weak_assumption" | "evidence_thin" | "confidence_overstated" | "scope_creep" | "sound",
  "body": "your objection in 2-5 sentences, addressed to the human reviewer",
  "findings": ["one short checkable point", "another"]
}`;

const VERDICTS = new Set([
  "weak_assumption",
  "evidence_thin",
  "confidence_overstated",
  "scope_creep",
  "sound",
]);

/**
 * Critique one proposal bundle. Returns a critique object, or null when the run
 * is out of model budget.
 *
 * Never throws on a bad model response: a research run must not die because the
 * skeptic returned malformed JSON. It degrades to an explicit "the skeptic could
 * not be parsed" critique so the reviewer sees that the lane ran and failed,
 * rather than silently seeing no objection and reading that as approval.
 */
export async function critiqueProposal(llm, caps, proposal, parseJson) {
  if (!caps.canCallModel()) return null;

  const user =
    `Proposal to attack:\n\n` +
    `TITLE: ${proposal.title}\n` +
    `STATUS: ${proposal.status} at confidence ${proposal.confidence}\n` +
    `CONFIDENCE RATIONALE: ${proposal.confidence_rationale}\n` +
    `DESCRIPTION: ${proposal.description}\n` +
    `ASSUMPTIONS: ${JSON.stringify(proposal.assumptions ?? [])}\n` +
    `FALSIFICATION: ${proposal.falsification_criteria ?? "(none given)"}\n` +
    `EVIDENCE OFFERED: ${JSON.stringify(proposal.evidence ?? [])}\n`;

  let resp;
  try {
    resp = await llm.complete([{ role: "user", content: user }], {
      system: SKEPTIC_SYSTEM,
      maxTokens: 700,
    });
  } catch (err) {
    return {
      verdict: "evidence_thin",
      body: `The skeptic pass could not run (${String(err.message ?? err).slice(0, 200)}). This proposal reached the queue WITHOUT an adversarial review — weigh it accordingly.`,
      findings: [],
      degraded: true,
    };
  }
  caps.recordCall(resp.usage);

  const obj = parseJson(resp.text);
  if (!obj || !VERDICTS.has(obj.verdict) || !String(obj.body ?? "").trim()) {
    return {
      verdict: "evidence_thin",
      body:
        "The skeptic returned a response that could not be parsed, so this proposal has NOT been adversarially reviewed. Treat it as uncritiqued rather than as unopposed.",
      findings: [],
      degraded: true,
    };
  }

  return {
    verdict: obj.verdict,
    body: String(obj.body).trim().slice(0, 4000),
    findings: Array.isArray(obj.findings)
      ? obj.findings.map((f) => String(f).trim().slice(0, 500)).filter(Boolean).slice(0, 10)
      : [],
    degraded: false,
  };
}

/** Shape the envelope the propose route expects. */
export function critiqueEnvelope(critique) {
  return {
    critic_name: SKEPTIC_NAME,
    verdict: critique.verdict,
    body: critique.body,
    findings: critique.findings,
  };
}
