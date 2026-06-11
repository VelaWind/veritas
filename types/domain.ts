/**
 * App-level types mirroring supabase/migrations/0001_core.sql.
 * The query layer (lib/queries/*) casts PostgREST results to these shapes.
 */

export type EpistemicStatus =
  | "established"
  | "strong_evidence"
  | "plausible"
  | "speculation"
  | "unknown";

export type HypothesisState =
  | "draft"
  | "active"
  | "contested"
  | "superseded"
  | "retired";

export type EvidenceRelation = "supports" | "opposes" | "neutral";

export type SourceType =
  | "peer_reviewed"
  | "preprint"
  | "book"
  | "dataset"
  | "experiment"
  | "observation"
  | "simulation_result"
  | "philosophical_argument"
  | "mathematical_proof"
  | "other";

export type EdgeType = "supports" | "contradicts" | "related_to" | "derived_from";

export type NodeType = "question" | "hypothesis" | "evidence" | "domain" | "simulation";

export type ActorType = "human" | "agent" | "system";

export type UserRole = "public" | "researcher" | "admin";

export type TimelineEventType =
  | "hypothesis_created"
  | "hypothesis_updated"
  | "hypothesis_status_changed"
  | "evidence_added"
  | "evidence_linked"
  | "evidence_unlinked"
  | "confidence_changed"
  | "contradiction_detected"
  | "contradiction_resolved"
  | "question_added"
  | "simulation_completed"
  | "note_published";

export type SimulationCategory =
  | "artificial_ecosystems"
  | "agent_intelligence"
  | "civilizations"
  | "universe_simulations"
  | "consciousness_experiments";

export type SimulationStatus = "planned" | "running" | "completed" | "archived";

export type ContradictionKind = "logical" | "evidential" | "assumption";

// ── Rows ────────────────────────────────────────────────────────────────────

export interface Profile {
  id: string;
  display_name: string;
  role: UserRole;
  created_at: string;
}

export interface Domain {
  id: string;
  slug: string;
  name: string;
  overview: string;
  icon: string | null;
  sort_order: number;
  research_status: string;
  created_at: string;
}

export interface Question {
  id: string;
  slug: string;
  domain_id: string;
  title: string;
  description: string;
  importance: number;
  status: EpistemicStatus;
  current_explanations: string;
  research_progress: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Assumption {
  text: string;
  justified: boolean;
  notes?: string;
}

export interface OpenQuestionItem {
  text: string;
}

export interface Hypothesis {
  id: string;
  slug: string;
  domain_id: string;
  question_id: string | null;
  title: string;
  description: string;
  status: EpistemicStatus;
  state: HypothesisState;
  confidence: number;
  confidence_rationale: string;
  assumptions: Assumption[];
  open_questions: OpenQuestionItem[];
  falsification_criteria: string;
  popularity: number;
  created_by: string | null;
  actor_type: ActorType;
  agent_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface Source {
  id: string;
  title: string;
  authors: string | null;
  url: string | null;
  doi: string | null;
  source_type: SourceType;
  year: number | null;
  reliability: number;
  created_at: string;
}

export interface Evidence {
  id: string;
  slug: string;
  title: string;
  summary: string;
  source_id: string | null;
  strength: number;
  domain_id: string | null;
  created_by: string | null;
  actor_type: ActorType;
  agent_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface HypothesisEvidenceLink {
  hypothesis_id: string;
  evidence_id: string;
  relation: EvidenceRelation;
  weight: number;
  notes: string;
  created_by: string | null;
  created_at: string;
}

export interface GraphEdge {
  id: string;
  from_type: NodeType;
  from_id: string;
  to_type: NodeType;
  to_id: string;
  edge: EdgeType;
  created_by: string | null;
  created_at: string;
}

export interface Contradiction {
  id: string;
  hypothesis_a: string;
  hypothesis_b: string;
  kind: ContradictionKind;
  explanation: string;
  detected_by: ActorType;
  resolved: boolean;
  resolution_notes: string;
  created_at: string;
}

export interface TimelineEvent {
  id: number;
  event_type: TimelineEventType;
  node_type: NodeType;
  node_id: string;
  summary: string;
  payload: Record<string, unknown>;
  actor_id: string | null;
  actor_type: ActorType;
  agent_name: string | null;
  created_at: string;
}

export interface ConfidenceHistoryEntry {
  id: number;
  hypothesis_id: string;
  old_value: number | null;
  new_value: number;
  rationale: string;
  actor_id: string | null;
  created_at: string;
}

export interface Simulation {
  id: string;
  slug: string;
  category: SimulationCategory;
  title: string;
  description: string;
  parameters: Record<string, unknown>;
  status: SimulationStatus;
  created_by: string | null;
  created_at: string;
}

export interface SimulationRun {
  id: string;
  simulation_id: string;
  parameters: Record<string, unknown>;
  results: Record<string, unknown>;
  metrics: Record<string, unknown>;
  artifact_path: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface ResearchNote {
  id: string;
  slug: string;
  title: string;
  body: string;
  published: boolean;
  author_id: string | null;
  created_at: string;
  updated_at: string;
}

// ── Composites used by pages ────────────────────────────────────────────────

export interface EvidenceWithSource extends Evidence {
  source: Source | null;
}

export interface EvidenceLinkFull {
  relation: EvidenceRelation;
  weight: number;
  notes: string;
  created_at: string;
  evidence: EvidenceWithSource;
}

export interface HypothesisListItem extends Hypothesis {
  domain: Pick<Domain, "id" | "slug" | "name"> | null;
}

export interface ContradictionWithPartners extends Contradiction {
  a: Pick<Hypothesis, "id" | "slug" | "title" | "status"> | null;
  b: Pick<Hypothesis, "id" | "slug" | "title" | "status"> | null;
}

export interface HypothesisFull extends Hypothesis {
  domain: Domain;
  question: Pick<Question, "id" | "slug" | "title"> | null;
  links: EvidenceLinkFull[];
  history: ConfidenceHistoryEntry[];
}

export interface QuestionWithDomain extends Question {
  domain: Pick<Domain, "id" | "slug" | "name"> | null;
}

export interface QuestionFull extends QuestionWithDomain {
  hypotheses: HypothesisListItem[];
}

export interface EvidenceListItem extends EvidenceWithSource {
  domain: Pick<Domain, "id" | "slug" | "name"> | null;
}

export interface EvidenceFull extends EvidenceListItem {
  linked_hypotheses: Array<{
    relation: EvidenceRelation;
    weight: number;
    notes: string;
    hypothesis: Pick<
      Hypothesis,
      "id" | "slug" | "title" | "status" | "confidence" | "state"
    > | null;
  }>;
}

export interface SimulationWithRuns extends Simulation {
  runs: SimulationRun[];
}

// ── Graph payloads (§7) ─────────────────────────────────────────────────────

export interface GraphNodeData {
  id: string;
  type: NodeType;
  label: string;
  slug: string;
  status: EpistemicStatus | null;
  confidence: number | null;
  domainSlug?: string | null;
}

export interface GraphEdgeData {
  from: string;
  to: string;
  type: EdgeType;
}

export interface GraphPayload {
  nodes: GraphNodeData[];
  edges: GraphEdgeData[];
}

// ── Search / stats payloads ─────────────────────────────────────────────────

export interface SearchResult {
  node_type: NodeType;
  id: string;
  slug: string;
  title: string;
  snippet: string;
  rank: number;
}

export interface DashboardStats {
  total_hypotheses: number;
  total_evidence: number;
  open_questions: number;
  total_simulation_runs: number;
  open_contradictions: number;
  confidence_distribution: Record<string, number> | null;
  activity_by_domain: Array<{ name: string; n: number }> | null;
  refreshed_at: string;
}

export interface ApiEnvelope<T> {
  data: T | null;
  error: string | null;
}
