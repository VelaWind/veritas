/**
 * Reference Database type for the Veritas schema.
 *
 * In CI / production this file should be regenerated with:
 *   supabase gen types typescript --project-id <ref> > types/database.types.ts
 *
 * The runtime clients are intentionally untyped (see DECISIONS.md) and the
 * query layer casts to the app types in types/domain.ts, so this file is a
 * stable reference rather than a load-bearing dependency — meaning a codegen
 * refresh can never break the build.
 */
import type {
  ActorType,
  Assumption,
  ContradictionKind,
  EdgeType,
  EpistemicStatus,
  EvidenceRelation,
  HypothesisState,
  NodeType,
  OpenQuestionItem,
  SimulationCategory,
  SimulationStatus,
  SourceType,
  TimelineEventType,
  UserRole,
} from "./domain";

type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

interface Table<Row> {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: unknown[];
}

export interface Database {
  public: {
    Tables: {
      profiles: Table<{
        id: string;
        display_name: string;
        role: UserRole;
        created_at: string;
      }>;
      domains: Table<{
        id: string;
        slug: string;
        name: string;
        overview: string;
        icon: string | null;
        sort_order: number;
        research_status: string;
        created_at: string;
      }>;
      questions: Table<{
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
      }>;
      hypotheses: Table<{
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
      }>;
      sources: Table<{
        id: string;
        title: string;
        authors: string | null;
        url: string | null;
        doi: string | null;
        source_type: SourceType;
        year: number | null;
        reliability: number;
        created_at: string;
      }>;
      evidence: Table<{
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
      }>;
      hypothesis_evidence: Table<{
        hypothesis_id: string;
        evidence_id: string;
        relation: EvidenceRelation;
        weight: number;
        notes: string;
        created_by: string | null;
        created_at: string;
      }>;
      graph_edges: Table<{
        id: string;
        from_type: NodeType;
        from_id: string;
        to_type: NodeType;
        to_id: string;
        edge: EdgeType;
        created_by: string | null;
        created_at: string;
      }>;
      contradictions: Table<{
        id: string;
        hypothesis_a: string;
        hypothesis_b: string;
        kind: ContradictionKind;
        explanation: string;
        detected_by: ActorType;
        resolved: boolean;
        resolution_notes: string;
        created_at: string;
      }>;
      timeline_events: Table<{
        id: number;
        event_type: TimelineEventType;
        node_type: NodeType;
        node_id: string;
        summary: string;
        payload: Json;
        actor_id: string | null;
        actor_type: ActorType;
        agent_name: string | null;
        created_at: string;
      }>;
      confidence_history: Table<{
        id: number;
        hypothesis_id: string;
        old_value: number | null;
        new_value: number;
        rationale: string;
        actor_id: string | null;
        created_at: string;
      }>;
      simulations: Table<{
        id: string;
        slug: string;
        category: SimulationCategory;
        title: string;
        description: string;
        parameters: Json;
        status: SimulationStatus;
        created_by: string | null;
        created_at: string;
      }>;
      simulation_runs: Table<{
        id: string;
        simulation_id: string;
        parameters: Json;
        results: Json;
        metrics: Json;
        artifact_path: string | null;
        started_at: string | null;
        finished_at: string | null;
        created_at: string;
      }>;
      research_notes: Table<{
        id: string;
        slug: string;
        title: string;
        body: string;
        published: boolean;
        author_id: string | null;
        created_at: string;
        updated_at: string;
      }>;
    };
    Views: {
      graph_nodes: {
        Row: {
          type: NodeType;
          id: string;
          slug: string;
          label: string;
          status: EpistemicStatus | null;
          confidence: number | null;
        };
      };
      dashboard_stats: {
        Row: {
          total_hypotheses: number;
          total_evidence: number;
          open_questions: number;
          total_simulation_runs: number;
          open_contradictions: number;
          confidence_distribution: Json;
          activity_by_domain: Json;
          refreshed_at: string;
        };
      };
    };
    Functions: {
      is_admin: { Args: Record<string, never>; Returns: boolean };
      suggested_confidence: { Args: { h_id: string }; Returns: number };
      scan_contradictions: { Args: Record<string, never>; Returns: number };
      increment_popularity: { Args: { h_id: string }; Returns: undefined };
      refresh_dashboard_stats: { Args: Record<string, never>; Returns: undefined };
      global_search: {
        Args: { q: string; lim?: number };
        Returns: Array<{
          node_type: NodeType;
          id: string;
          slug: string;
          title: string;
          snippet: string;
          rank: number;
        }>;
      };
    };
    Enums: {
      epistemic_status: EpistemicStatus;
      hypothesis_state: HypothesisState;
      evidence_relation: EvidenceRelation;
      source_type: SourceType;
      edge_type: EdgeType;
      node_type: NodeType;
      actor_type: ActorType;
      user_role: UserRole;
      timeline_event_type: TimelineEventType;
    };
  };
}
