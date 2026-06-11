import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Domain,
  EpistemicStatus,
  GraphEdge,
  GraphPayload,
} from "@/types/domain";
import { logQueryError, logQueryThrow } from "./log";

interface HypothesisRow {
  id: string;
  slug: string;
  title: string;
  status: EpistemicStatus;
  confidence: number;
  domain_id: string;
  question_id: string | null;
}

interface QuestionRow {
  id: string;
  slug: string;
  title: string;
  status: EpistemicStatus;
  domain_id: string;
}

interface EvidenceRow {
  id: string;
  slug: string;
  title: string;
  strength: number;
  domain_id: string | null;
}

/**
 * §7: nodes from all entity tables plus explicit graph_edges, augmented with
 * implicit edges (hypothesis→domain, hypothesis→question, question→domain).
 * Evidence↔hypothesis edges already exist in graph_edges via the link trigger.
 */
export async function getGraphPayload(
  client: SupabaseClient,
  opts: { domainSlug?: string } = {},
): Promise<GraphPayload> {
  try {
    const [domainsRes, questionsRes, hypothesesRes, evidenceRes, edgesRes] =
      await Promise.all([
        client.from("domains").select("id, slug, name").order("sort_order"),
        client.from("questions").select("id, slug, title, status, domain_id"),
        client
          .from("hypotheses")
          .select("id, slug, title, status, confidence, domain_id, question_id")
          .neq("state", "draft"),
        client.from("evidence").select("id, slug, title, strength, domain_id"),
        client.from("graph_edges").select("*"),
      ]);

    // Surface any partial failure instead of silently returning a thin graph.
    for (const [name, res] of [
      ["domains", domainsRes],
      ["questions", questionsRes],
      ["hypotheses", hypothesesRes],
      ["evidence", evidenceRes],
      ["graph_edges", edgesRes],
    ] as const) {
      if (res.error) logQueryError(`getGraphPayload:${name}`, res.error, null);
    }

    const domains = (domainsRes.data ?? []) as Array<Pick<Domain, "id" | "slug" | "name">>;
    const questions = (questionsRes.data ?? []) as QuestionRow[];
    const hypotheses = (hypothesesRes.data ?? []) as HypothesisRow[];
    const evidence = (evidenceRes.data ?? []) as EvidenceRow[];
    const explicitEdges = (edgesRes.data ?? []) as GraphEdge[];

    const domainById = new Map(domains.map((d) => [d.id, d]));
    const domainFilterId = opts.domainSlug
      ? domains.find((d) => d.slug === opts.domainSlug)?.id ?? null
      : null;

    const payload: GraphPayload = { nodes: [], edges: [] };
    const included = new Set<string>();

    const inDomain = (domainId: string | null | undefined) =>
      !domainFilterId || domainId === domainFilterId;

    for (const d of domains) {
      if (domainFilterId && d.id !== domainFilterId) continue;
      payload.nodes.push({
        id: d.id,
        type: "domain",
        label: d.name,
        slug: d.slug,
        status: null,
        confidence: null,
        domainSlug: d.slug,
      });
      included.add(d.id);
    }

    for (const q of questions) {
      if (!inDomain(q.domain_id)) continue;
      payload.nodes.push({
        id: q.id,
        type: "question",
        label: q.title,
        slug: q.slug,
        status: q.status,
        confidence: null,
        domainSlug: domainById.get(q.domain_id)?.slug ?? null,
      });
      included.add(q.id);
      if (included.has(q.domain_id)) {
        payload.edges.push({ from: q.id, to: q.domain_id, type: "related_to" });
      }
    }

    for (const h of hypotheses) {
      if (!inDomain(h.domain_id)) continue;
      payload.nodes.push({
        id: h.id,
        type: "hypothesis",
        label: h.title,
        slug: h.slug,
        status: h.status,
        confidence: h.confidence,
        domainSlug: domainById.get(h.domain_id)?.slug ?? null,
      });
      included.add(h.id);
      if (included.has(h.domain_id)) {
        payload.edges.push({ from: h.id, to: h.domain_id, type: "related_to" });
      }
      if (h.question_id && included.has(h.question_id)) {
        payload.edges.push({ from: h.id, to: h.question_id, type: "derived_from" });
      }
    }

    // Evidence nodes: include those linked to included hypotheses (or all when
    // unfiltered). Edge presence decides inclusion under a domain filter.
    const evidenceById = new Map(evidence.map((e) => [e.id, e]));
    const evidenceToInclude = new Set<string>();
    for (const edge of explicitEdges) {
      if (edge.from_type === "evidence" && included.has(edge.to_id)) {
        evidenceToInclude.add(edge.from_id);
      }
      if (edge.to_type === "evidence" && included.has(edge.from_id)) {
        evidenceToInclude.add(edge.to_id);
      }
    }
    if (!domainFilterId) for (const e of evidence) evidenceToInclude.add(e.id);

    for (const id of evidenceToInclude) {
      const e = evidenceById.get(id);
      if (!e) continue;
      payload.nodes.push({
        id: e.id,
        type: "evidence",
        label: e.title,
        slug: e.slug,
        status: null,
        confidence: e.strength,
        domainSlug: e.domain_id ? domainById.get(e.domain_id)?.slug ?? null : null,
      });
      included.add(e.id);
    }

    for (const edge of explicitEdges) {
      if (included.has(edge.from_id) && included.has(edge.to_id)) {
        payload.edges.push({ from: edge.from_id, to: edge.to_id, type: edge.edge });
      }
    }

    return payload;
  } catch (err) {
    return logQueryThrow("getGraphPayload", err, { nodes: [], edges: [] });
  }
}
