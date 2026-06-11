import type { EpistemicStatus, NodeType } from "@/types/domain";
import { STATUS_META } from "./taxonomy";

/**
 * §7 visual encoding. Node color = epistemic signal hue; shape by type
 * (circle = hypothesis, diamond = question, square = evidence, ring = domain,
 * triangle = simulation). Edge style: solid = supports, dashed = contradicts,
 * dotted = related/derived. Colors resolve from CSS vars at draw time so the
 * graph follows the active theme.
 */
export const NODE_SHAPE: Record<NodeType, "circle" | "diamond" | "square" | "ring" | "triangle"> = {
  hypothesis: "circle",
  question: "diamond",
  evidence: "square",
  domain: "ring",
  simulation: "triangle",
};

export function nodeColorVar(type: NodeType, status: EpistemicStatus | null): string {
  if (type === "domain") return "--accent";
  if (type === "evidence") return "--text-muted";
  if (type === "simulation") return "--text-muted";
  if (status) return STATUS_META[status].cssVar;
  return "--signal-unknown";
}

export function nodeRadius(type: NodeType, confidence: number | null): number {
  if (type === "domain") return 11;
  if (type === "question") return 7;
  if (type === "evidence") return 5;
  if (type === "simulation") return 6;
  // hypotheses scale subtly with confidence
  return 5 + ((confidence ?? 0) / 100) * 5;
}

export const EDGE_STYLE: Record<
  string,
  { dash: number[]; colorVar: string; width: number }
> = {
  supports: { dash: [], colorVar: "--signal-strong", width: 1 },
  contradicts: { dash: [4, 3], colorVar: "--contradiction", width: 1.25 },
  related_to: { dash: [1, 3], colorVar: "--border", width: 1 },
  derived_from: { dash: [1, 3], colorVar: "--accent", width: 1 },
};

export const NODE_TYPE_LABEL: Record<NodeType, string> = {
  hypothesis: "Hypothesis",
  question: "Question",
  evidence: "Evidence",
  domain: "Domain",
  simulation: "Simulation",
};
