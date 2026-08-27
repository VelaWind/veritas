import type { CouncilOutcome, CouncilRole, CouncilStatus } from "@/types/domain";

/**
 * Presentation metadata for council transcripts (§D.3).
 *
 * `split` is deliberately NOT styled as a failure. A council that ended apart
 * produced a real result — the disagreement, stated precisely enough to be
 * useful — and colouring it as an error would teach the reader the opposite of
 * what this phase is for. It gets `--signal-mid` (uncertain), not
 * `--signal-weak`. `no_verdict` gets grey for the same reason `unknown` is grey
 * elsewhere in the map: not knowing is not being wrong.
 */
export const OUTCOME_META: Record<
  CouncilOutcome,
  { label: string; cssVar: string; description: string }
> = {
  consensus: {
    label: "consensus",
    cssVar: "--signal-strong",
    description: "The roles converged on a position.",
  },
  split: {
    label: "split",
    cssVar: "--signal-mid",
    description:
      "The roles did not converge. The disagreement is the result — recorded rather than resolved by force.",
  },
  no_verdict: {
    label: "no verdict",
    cssVar: "--signal-unknown",
    description:
      "The debate did not get far enough to support a verdict. An honest empty answer.",
  },
};

export const STATUS_META: Record<
  CouncilStatus,
  { label: string; cssVar: string; description: string }
> = {
  running: {
    label: "running",
    cssVar: "--signal-mid",
    description: "This council is still in session.",
  },
  complete: {
    label: "complete",
    cssVar: "--signal-strong",
    description: "The council ran to completion.",
  },
  aborted: {
    label: "aborted",
    cssVar: "--signal-weak",
    description: "The council stopped before finishing. The reason is recorded below.",
  },
};

export const ROLE_ORDER: CouncilRole[] = [
  "advocate",
  "skeptic",
  "verifier",
  "synthesizer",
];

export const ROLE_META: Record<CouncilRole, { label: string; blurb: string }> = {
  advocate: {
    label: "Advocate",
    blurb: "Makes the strongest honest case for the claim — the narrow version if that is the strongest.",
  },
  skeptic: {
    label: "Skeptic",
    blurb: "Attacks the claim and the case for it. It cannot block anything, which is why it can be uncompromising.",
  },
  verifier: {
    label: "Verifier",
    blurb: "Audits what was said against what is established. “I cannot verify this” is a real finding.",
  },
  synthesizer: {
    label: "Synthesizer",
    blurb: "States where the debate stands. Not a judge: there is no casting vote.",
  },
};

/** Group turns into rounds, preserving seq order within each. */
export function byRound<T extends { round: number; seq: number }>(
  turns: T[],
): Array<{ round: number; turns: T[] }> {
  const map = new Map<number, T[]>();
  for (const t of turns) {
    const list = map.get(t.round);
    if (list) list.push(t);
    else map.set(t.round, [t]);
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([round, list]) => ({
      round,
      turns: [...list].sort((a, b) => a.seq - b.seq),
    }));
}
