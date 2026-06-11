import type { ContradictionKind } from "@/types/domain";

export const CONTRADICTION_KINDS: ContradictionKind[] = [
  "logical",
  "evidential",
  "assumption",
];

export const CONTRADICTION_KIND_META: Record<
  ContradictionKind,
  { label: string; description: string }
> = {
  logical: {
    label: "Logical",
    description: "The hypotheses cannot both be true as stated.",
  },
  evidential: {
    label: "Evidential",
    description:
      "The hypotheses draw opposite conclusions from the same evidence.",
  },
  assumption: {
    label: "Assumption",
    description: "The hypotheses rest on mutually exclusive assumptions.",
  },
};

/**
 * The authoritative scan is `scan_contradictions()` in Postgres (§2.7),
 * triggered from POST /api/contradictions/scan. This module only carries
 * shared labels so the review queue and flags describe records identically.
 */
