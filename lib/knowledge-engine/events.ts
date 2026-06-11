import type { TimelineEventType } from "@/types/domain";

/**
 * Display metadata for timeline events. `link` builds the public href from the
 * event row (node_type has no 'note' member, so research-note publications are
 * recorded as node_type='hypothesis' with payload.kind='research_note').
 */
export const EVENT_META: Record<
  TimelineEventType,
  { label: string; cssVar: string }
> = {
  hypothesis_created: { label: "Hypothesis created", cssVar: "--accent" },
  hypothesis_updated: { label: "Hypothesis revised", cssVar: "--text-muted" },
  hypothesis_status_changed: { label: "Status changed", cssVar: "--signal-mid" },
  evidence_added: { label: "Evidence added", cssVar: "--accent" },
  evidence_linked: { label: "Evidence linked", cssVar: "--signal-strong" },
  evidence_unlinked: { label: "Evidence unlinked", cssVar: "--text-muted" },
  confidence_changed: { label: "Confidence changed", cssVar: "--signal-mid" },
  contradiction_detected: { label: "Contradiction detected", cssVar: "--contradiction" },
  contradiction_resolved: { label: "Contradiction resolved", cssVar: "--signal-strong" },
  question_added: { label: "Question raised", cssVar: "--accent" },
  simulation_completed: { label: "Simulation completed", cssVar: "--signal-strong" },
  note_published: { label: "Note published", cssVar: "--accent" },
};

export const EVENT_TYPES = Object.keys(EVENT_META) as TimelineEventType[];

export function eventHref(event: {
  event_type: TimelineEventType;
  node_type: string;
  node_id: string;
  payload: Record<string, unknown>;
}): string | null {
  const slug = typeof event.payload?.slug === "string" ? event.payload.slug : null;
  if (event.event_type === "note_published" && slug) return `/notes/${slug}`;
  // Most events carry node_id (a UUID) rather than a slug; the timeline links
  // by node type where a stable public slug route exists, else returns null.
  return null;
}
