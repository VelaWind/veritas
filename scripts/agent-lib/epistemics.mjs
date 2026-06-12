// Mirror of lib/knowledge-engine/taxonomy.ts STATUS_META bands and the DB
// `epistemics_consistent` CHECK — in plain JS for the .mjs runners. Used to
// REPAIR model output so a proposal can never be rejected by the epistemic guard
// at approval time for an out-of-band status/confidence pairing.

export const STATUS_BANDS = {
  established: { min: 81, max: 100 },
  strong_evidence: { min: 61, max: 80 },
  plausible: { min: 21, max: 60 },
  speculation: { min: 0, max: 40 },
  unknown: { min: 0, max: 20 },
};

export const EPISTEMIC_STATUSES = Object.keys(STATUS_BANDS);

export function isConsistent(status, confidence) {
  const b = STATUS_BANDS[status];
  return !!b && confidence >= b.min && confidence <= b.max;
}

/** Clamp confidence into the band for the chosen status (band midpoint if NaN). */
export function clampConfidence(status, confidence) {
  const b = STATUS_BANDS[status];
  if (!b) return Number.isFinite(confidence) ? Math.round(confidence) : 30;
  if (!Number.isFinite(confidence)) return Math.round((b.min + b.max) / 2);
  return Math.min(b.max, Math.max(b.min, Math.round(confidence)));
}

/** Coerce an arbitrary model-supplied status to a known one (default speculation). */
export function normalizeStatus(status) {
  const s = String(status || "").toLowerCase().replace(/\s+/g, "_");
  return EPISTEMIC_STATUSES.includes(s) ? s : "speculation";
}
