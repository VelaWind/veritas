// Per-run caps (DECISIONS §B.7) — the client-side half of the two-layer defense
// (the authoritative half is the enforce_agent_quota DB trigger). A run leaves
// any proposals it already made, but never exceeds a bound: it stops the moment
// model calls, cumulative output tokens, or proposals reach their cap.
import { intArg } from "./args.mjs";

export class RunCaps {
  constructor({ maxModelCalls, maxProposals, maxOutputTokens }) {
    this.maxModelCalls = maxModelCalls;
    this.maxProposals = maxProposals;
    this.maxOutputTokens = maxOutputTokens;
    this.modelCalls = 0;
    this.proposals = 0;
    this.outputTokens = 0;
    this.stoppedReason = null;
  }

  /** May we make another model call? Records the stop reason if not. */
  canCallModel() {
    if (this.modelCalls >= this.maxModelCalls) {
      this.stoppedReason ??= `model-call cap reached (${this.maxModelCalls})`;
      return false;
    }
    if (this.outputTokens >= this.maxOutputTokens) {
      this.stoppedReason ??= `output-token cap reached (${this.maxOutputTokens})`;
      return false;
    }
    return true;
  }

  recordCall(usage) {
    this.modelCalls += 1;
    this.outputTokens += usage?.output_tokens ?? 0;
  }

  /** May we make another proposal (queue insert)? */
  canPropose() {
    if (this.proposals >= this.maxProposals) {
      this.stoppedReason ??= `proposal cap reached (${this.maxProposals})`;
      return false;
    }
    return true;
  }

  recordProposal() {
    this.proposals += 1;
  }

  summary() {
    return (
      `model calls ${this.modelCalls}/${this.maxModelCalls} · ` +
      `proposals ${this.proposals}/${this.maxProposals} · ` +
      `output tokens ${this.outputTokens}/${this.maxOutputTokens}`
    );
  }
}

/** Build caps from CLI args, falling back to AGENT_MAX_* env, then cheap defaults. */
export function capsFromArgs(args) {
  return new RunCaps({
    maxModelCalls: intArg(
      args["max-model-calls"] ?? process.env.AGENT_MAX_MODEL_CALLS,
      8,
    ),
    maxProposals: intArg(
      args["max-proposals"] ?? process.env.AGENT_MAX_PROPOSALS,
      5,
    ),
    maxOutputTokens: intArg(
      args["max-output-tokens"] ?? process.env.AGENT_MAX_OUTPUT_TOKENS,
      50_000,
    ),
  });
}
