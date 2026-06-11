import type { SupabaseClient } from "@supabase/supabase-js";
import type { EvidenceFull, EvidenceListItem, SourceType } from "@/types/domain";
import { logQueryError, logQueryThrow } from "./log";

export interface EvidenceFilters {
  domainSlug?: string;
  sourceType?: SourceType;
  limit?: number;
}

export async function listEvidence(
  client: SupabaseClient,
  filters: EvidenceFilters = {},
): Promise<EvidenceListItem[]> {
  try {
    const domainEmbed = filters.domainSlug
      ? "domain:domains!inner(id, slug, name)"
      : "domain:domains(id, slug, name)";
    const sourceEmbed = filters.sourceType
      ? "source:sources!inner(*)"
      : "source:sources(*)";
    let query = client
      .from("evidence")
      .select(`*, ${sourceEmbed}, ${domainEmbed}`);

    if (filters.domainSlug) query = query.eq("domain.slug", filters.domainSlug);
    if (filters.sourceType) query = query.eq("source.source_type", filters.sourceType);

    const { data, error } = await query
      .order("created_at", { ascending: false })
      .limit(filters.limit ?? 200);
    if (error) return logQueryError("listEvidence", error, []);
    return (data ?? []) as unknown as EvidenceListItem[];
  } catch (err) {
    return logQueryThrow("listEvidence", err, []);
  }
}

export async function getEvidenceBySlug(
  client: SupabaseClient,
  slug: string,
): Promise<EvidenceFull | null> {
  try {
    const { data, error } = await client
      .from("evidence")
      .select(
        `*,
         source:sources(*),
         domain:domains(id, slug, name),
         linked_hypotheses:hypothesis_evidence(relation, weight, notes,
           hypothesis:hypotheses(id, slug, title, status, confidence, state))`,
      )
      .eq("slug", slug)
      .maybeSingle();
    if (error) return logQueryError("getEvidenceBySlug", error, null);
    if (!data) return null;
    const full = data as unknown as EvidenceFull;
    // Drafts are filtered by RLS for anon readers; drop any null embeds.
    full.linked_hypotheses = (full.linked_hypotheses ?? []).filter(
      (l) => l.hypothesis !== null,
    );
    return full;
  } catch (err) {
    return logQueryThrow("getEvidenceBySlug", err, null);
  }
}

export async function listEvidenceSlugs(client: SupabaseClient): Promise<string[]> {
  try {
    const { data, error } = await client.from("evidence").select("slug");
    if (error) return logQueryError("listEvidenceSlugs", error, []);
    return ((data ?? []) as Array<{ slug: string }>).map((e) => e.slug);
  } catch (err) {
    return logQueryThrow("listEvidenceSlugs", err, []);
  }
}
