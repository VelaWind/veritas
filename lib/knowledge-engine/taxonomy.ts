import type { EpistemicStatus, HypothesisState } from "@/types/domain";

/**
 * The epistemic taxonomy — single source of labels, signal-color mapping and
 * confidence bounds, mirroring the DB `epistemics_consistent` constraint.
 * Signal colors are reserved for epistemic state; unknown is grey, never red.
 */

export interface StatusMeta {
  value: EpistemicStatus;
  /** Chip text — §5.4: never restyled, never omitted. */
  chip: string;
  label: string;
  description: string;
  /** CSS custom property carrying the signal hue. */
  cssVar: string;
  min: number;
  max: number;
}

export const STATUS_META: Record<EpistemicStatus, StatusMeta> = {
  established: {
    value: "established",
    chip: "ESTABLISHED",
    label: "Established Knowledge",
    description:
      "Overwhelming convergent evidence; reversal would be revolutionary.",
    cssVar: "--signal-strong",
    min: 81,
    max: 100,
  },
  strong_evidence: {
    value: "strong_evidence",
    chip: "STRONG EVIDENCE",
    label: "Strong Evidence",
    description:
      "Well supported by multiple independent lines of evidence; open questions remain.",
    cssVar: "--signal-strong",
    min: 61,
    max: 80,
  },
  plausible: {
    value: "plausible",
    chip: "PLAUSIBLE",
    label: "Plausible Hypothesis",
    description:
      "Consistent with evidence and theory; rivals remain credible.",
    cssVar: "--signal-mid",
    min: 21,
    max: 60,
  },
  speculation: {
    value: "speculation",
    chip: "SPECULATION",
    label: "Speculation",
    description:
      "Coherent but weakly constrained by evidence; held lightly.",
    cssVar: "--signal-weak",
    min: 0,
    max: 40,
  },
  unknown: {
    value: "unknown",
    chip: "UNKNOWN",
    label: "Unknown",
    description:
      "Not enough evidence to favor any answer. A state of the map, not an error.",
    cssVar: "--signal-unknown",
    min: 0,
    max: 20,
  },
};

export const EPISTEMIC_STATUSES = Object.keys(STATUS_META) as EpistemicStatus[];

export const HYPOTHESIS_STATES: HypothesisState[] = [
  "draft",
  "active",
  "contested",
  "superseded",
  "retired",
];

/** Mirrors the DB constraint exactly. */
export function isConsistent(status: EpistemicStatus, confidence: number): boolean {
  const meta = STATUS_META[status];
  return confidence >= meta.min && confidence <= meta.max;
}

/** Statuses a given confidence value may legally carry. */
export function statusesForConfidence(confidence: number): EpistemicStatus[] {
  return EPISTEMIC_STATUSES.filter((s) => isConsistent(s, confidence));
}

/** §5.5 — the five named bands ghosted under every Confidence Meter. */
export const CONFIDENCE_BANDS = [
  { label: "Very Weak", from: 0, to: 20 },
  { label: "Weak", from: 21, to: 40 },
  { label: "Uncertain", from: 41, to: 60 },
  { label: "Strong", from: 61, to: 80 },
  { label: "Very Strong", from: 81, to: 100 },
] as const;

export function bandForConfidence(confidence: number) {
  return (
    CONFIDENCE_BANDS.find((b) => confidence >= b.from && confidence <= b.to) ??
    CONFIDENCE_BANDS[0]
  );
}

export const STATE_LABELS: Record<HypothesisState, string> = {
  draft: "Draft",
  active: "Active",
  contested: "Contested",
  superseded: "Superseded",
  retired: "Retired",
};
