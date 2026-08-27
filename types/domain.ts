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

export type UserRole = "public" | "researcher" | "admin" | "agent";

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

// ── Suggestion queue (Post-1.0 Phase A) ─────────────────────────────────────

export type SuggestionOperation = "create" | "edit";
export type SuggestionStatus = "pending" | "approved" | "rejected" | "withdrawn";
/** A node kind a contributor may propose (subset of NodeType). */
export type SuggestionTarget = "hypothesis" | "evidence";

export interface Suggestion {
  id: string;
  target_type: SuggestionTarget;
  operation: SuggestionOperation;
  target_id: string | null;
  payload: Record<string, unknown>;
  rationale: string;
  status: SuggestionStatus;
  proposed_by: string | null;
  actor_type: ActorType;
  agent_name: string | null;
  reviewed_by: string | null;
  review_notes: string;
  reviewed_at: string | null;
  applied_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SuggestionWithProposer extends Suggestion {
  proposer: { display_name: string; role: UserRole } | null;
  /**
   * Phase D §D.2 — the skeptic's objection, shown beside the proposal in review.
   * Absent for human proposals and for lanes that are not critiqued.
   */
  critiques?: SuggestionCritiqueRow[];
}

/** Embedded shape returned with a suggestion (see `suggestion_critiques`). */
export interface SuggestionCritiqueRow {
  critic_name: string;
  verdict: CritiqueVerdict;
  body: string;
  findings: string[];
  created_at: string;
}

// ── Agent layer (Post-1.0 Phase B) ──────────────────────────────────────────

/** Per-agent bounds, stored on `agents.scopes` jsonb. */
export interface AgentScopes {
  /** Allowed domain ids; empty/absent means unrestricted. */
  domains?: string[];
  /** Max outstanding `pending` suggestions (server-enforced). */
  max_pending?: number;
  /** Max proposals a single runner pass may make (client-enforced default). */
  max_per_run?: number;
  /** Max suggestions from this agent per rolling hour (server-enforced). */
  max_per_hour?: number;
}

// ── Agent society (Post-1.0 Phase D) ────────────────────────────────────────

export type AgentKind =
  | "research"
  | "contradiction"
  | "skeptic"
  | "verifier"
  | "council"
  | "internal_affairs";

/** Authoritative since 0007; `enabled` is derived from it. */
export type AgentStatus = "active" | "throttled" | "suspended";

export interface Agent {
  id: string;
  name: string;
  display_name: string;
  kind: AgentKind;
  charter: string;
  /** Declared field of expertise — distinct from the enforced `scopes.domains`. */
  domain_id: string | null;
  status: AgentStatus;
  profile_id: string;
  /** Derived from `status` by trigger; never set it directly. */
  enabled: boolean;
  scopes: AgentScopes;
  /** 0–100, derived from approve/reject history. Admin-only — never public. */
  trust: number;
  created_at: string;
  updated_at: string;
}

/**
 * The public projection (`agent_public` view). Deliberately excludes `trust`,
 * `scopes`, and `profile_id`: the column list is the security boundary, because
 * RLS cannot restrict columns. See DECISIONS §D.1.
 */
export interface AgentPublic {
  name: string;
  display_name: string;
  kind: AgentKind;
  charter: string;
  status: AgentStatus;
  domain_slug: string | null;
  domain_name: string | null;
  created_at: string;
}

/** Counts only, from `agent_public_stats`. Never payloads or pending content. */
export interface AgentPublicStats {
  name: string;
  proposed: number;
  approved: number;
  rejected: number;
  pending: number;
  /** null until the agent has at least one decided proposal. */
  approval_rate: number | null;
}

export interface AgentProfile extends AgentPublic {
  stats: AgentPublicStats | null;
}

export type CritiqueVerdict =
  | "weak_assumption"
  | "evidence_thin"
  | "confidence_overstated"
  | "scope_creep"
  | "sound";

/** The skeptic's annotation on a proposal (§D.2). Admin-only, like the queue. */
export interface SuggestionCritique {
  id: string;
  suggestion_id: string;
  critic_agent_id: string | null;
  critic_name: string;
  verdict: CritiqueVerdict;
  body: string;
  findings: string[];
  created_at: string;
}

export type CitationStatus = "verified" | "unresolved" | "mismatch";

/** Keyed on the citation, not on a row — see DECISIONS §D.5a. Public. */
export interface CitationCheck {
  citation_key: string;
  doi: string | null;
  url: string | null;
  claimed_title: string;
  status: CitationStatus;
  resolved_title: string | null;
  resolved_year: number | null;
  matched_via: string;
  score: number | null;
  source: string;
  checked_at: string;
}

export interface AgentToken {
  id: string;
  agent_id: string;
  token_hash: string;
  label: string;
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
  created_at: string;
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

// ─── Council (§D.3, migration 0010) ──────────────────────────────────────────
// Both tables are PUBLIC: the transcript is the transparency artifact of Phase
// D. The queue stays private — what an agent argued is public record, what it
// has proposed and not yet had accepted is not.

export type CouncilRole = "advocate" | "skeptic" | "verifier" | "synthesizer";

/** No "majority wins" path. A split is a result, not a failure to decide. */
export type CouncilOutcome = "consensus" | "split" | "no_verdict";

export type CouncilStatus = "running" | "complete" | "aborted";

export interface Council {
  id: string;
  /** Constrained to hypothesis | question by a CHECK; carries no FK (polymorphic). */
  subject_type: "hypothesis" | "question";
  subject_id: string;
  subject_slug: string;
  subject_title: string;
  status: CouncilStatus;
  rounds_run: number;
  outcome: CouncilOutcome | null;
  /** Each role's final position, in that role's own voice. */
  vote: Partial<Record<CouncilRole, string>> | null;
  verdict: string;
  /** Null until the verdict is wired to the propose route — see DECISIONS §D.3. */
  suggestion_id: string | null;
  model: string;
  /** Non-empty whenever status is 'aborted' (enforced by a CHECK). */
  abort_reason: string;
  started_at: string;
  completed_at: string | null;
}

export interface CouncilTurn {
  id: string;
  council_id: string;
  round: number;
  seq: number;
  role: CouncilRole;
  agent_id: string | null;
  agent_name: string;
  content: string;
  /** Stored apart from content because the next round's prompt is built from it. */
  reasoning: string;
  /**
   * True when this turn argued from a transcript the context budget had already
   * trimmed. Without it, a late turn that never saw the opening arguments is
   * indistinguishable from one that did.
   */
  context_truncated: boolean;
  created_at: string;
}

export interface CouncilWithTurns extends Council {
  turns: CouncilTurn[];
}
