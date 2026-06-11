import type { EvidenceRelation } from "@/types/domain";

export interface ScoredLink {
  relation: EvidenceRelation;
  /** Link weight 0–100. */
  weight: number;
  /** Evidence strength 0–100. */
  strength: number;
  /** Source reliability 0–100 (50 when no source). */
  reliability: number;
}

/**
 * Client-side mirror of the §2.7 `suggested_confidence` SQL:
 *   score = 50 + 50·Σ(signal) / max(√n, 1), clamped to [0,100]
 * where signal = ±(weight·strength·reliability)/100³.
 * The DB value is authoritative; this exists for instant form previews.
 */
export function suggestedConfidence(links: ScoredLink[]): number {
  if (links.length === 0) return 50;
  const sum = links.reduce((acc, l) => {
    const sign = l.relation === "supports" ? 1 : l.relation === "opposes" ? -1 : 0;
    return acc + sign * (l.weight / 100) * (l.strength / 100) * (l.reliability / 100);
  }, 0);
  const raw = Math.round(50 + (50 * sum) / Math.max(Math.sqrt(links.length), 1));
  return Math.max(0, Math.min(100, raw));
}
