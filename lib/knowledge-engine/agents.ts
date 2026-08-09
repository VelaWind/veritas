import type { AgentKind, AgentStatus } from "@/types/domain";

/**
 * Presentation metadata for the public agent roster (§D.1).
 *
 * Status colours reuse the signal palette rather than a red/green pass-fail
 * language: a throttled or suspended agent is a *state of the instrument*, the
 * same way `unknown` is a state of the map and not an error. `--signal-unknown`
 * is grey for exactly that reason (§contrast.mjs covers both surfaces).
 */
export const KIND_ORDER: AgentKind[] = [
  "research",
  "contradiction",
  "skeptic",
  "verifier",
  "council",
  "internal_affairs",
];

export const KIND_META: Record<AgentKind, { label: string; blurb: string }> = {
  research: {
    label: "Domain researchers",
    blurb:
      "One per field. They read source material and propose hypotheses and evidence into the review queue.",
  },
  contradiction: {
    label: "Contradiction",
    blurb:
      "Looks for tension between claims that the mechanical scan cannot see — assumption-level conflicts rather than shared-evidence ones.",
  },
  skeptic: {
    label: "Skeptic",
    blurb:
      "Attacks every proposal before a human sees it. It annotates and cannot block; the objection travels with the proposal.",
  },
  verifier: {
    label: "Citation verifier",
    blurb:
      "Resolves references against Crossref and OpenAlex. An unresolved citation is a flag for a reviewer, never an automatic rejection.",
  },
  council: {
    label: "Council",
    blurb:
      "Convened on demand to debate one claim across several rounds. Disagreement is recorded as an outcome, not resolved by force.",
  },
  internal_affairs: {
    label: "Internal Affairs",
    blurb:
      "Audits the roster, including itself. It may throttle or suspend an agent; only a human can reinstate one.",
  },
};

export const STATUS_META: Record<
  AgentStatus,
  { label: string; cssVar: string; description: string }
> = {
  active: {
    label: "active",
    cssVar: "--signal-strong",
    description: "Working normally.",
  },
  throttled: {
    label: "throttled",
    cssVar: "--signal-mid",
    description:
      "Still working, at reduced volume. Its queue caps are divided while the throttle stands.",
  },
  suspended: {
    label: "suspended",
    cssVar: "--signal-unknown",
    description:
      "Proposals are refused at the database. Only a human can reinstate it.",
  },
};
