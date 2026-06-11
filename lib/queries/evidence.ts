import type { SupabaseClient } from "@supabase/supabase-js";
import type { EvidenceFull, EvidenceListItem, SourceType } from "@/types/domain";

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
    if (error) return [];
    return (data ?? []) as unknown as EvidenceListItem[];
  } catch {
    return [];
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
    if (error || !data) return null;
    const full = data as unknown as EvidenceFull;
    // Drafts are filtered by RLS for anon readers; drop any null embeds.
    full.linked_hypotheses = (full.linked_hypotheses ?? []).filter(
      (l) => l.hypothesis !== null,
    );
    return full;
  } catch {
    return null;
  }
}

export async function listEvidenceSlugs(client: SupabaseClient): Promise<string[]> {
  try {
    const { data, error } = await client.from("evidence").select("slug");
    if (error) return [];
    return ((data ?? []) as Array<{ slug: string }>).map((e) => e.slug);
  } catch {
    return [];
  }
}
