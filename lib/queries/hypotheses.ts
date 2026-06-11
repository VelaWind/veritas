import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  EpistemicStatus,
  HypothesisFull,
  HypothesisListItem,
} from "@/types/domain";

export interface HypothesisFilters {
  domainSlug?: string;
  status?: EpistemicStatus;
  minConfidence?: number;
  sort?: "confidence" | "updated" | "created" | "popularity";
  includeDrafts?: boolean;
  limit?: number;
}

export async function listHypotheses(
  client: SupabaseClient,
  filters: HypothesisFilters = {},
): Promise<HypothesisListItem[]> {
  try {
    const embed = filters.domainSlug
      ? "*, domain:domains!inner(id, slug, name)"
      : "*, domain:domains(id, slug, name)";
    let query = client.from("hypotheses").select(embed);

    if (!filters.includeDrafts) query = query.neq("state", "draft");
    if (filters.domainSlug) query = query.eq("domain.slug", filters.domainSlug);
    if (filters.status) query = query.eq("status", filters.status);
    if (filters.minConfidence !== undefined && filters.minConfidence > 0) {
      query = query.gte("confidence", filters.minConfidence);
    }

    switch (filters.sort) {
      case "confidence":
        query = query.order("confidence", { ascending: false });
        break;
      case "created":
        query = query.order("created_at", { ascending: false });
        break;
      case "popularity":
        query = query.order("popularity", { ascending: false });
        break;
      case "updated":
      default:
        query = query.order("updated_at", { ascending: false });
        break;
    }

    const { data, error } = await query.limit(filters.limit ?? 200);
    if (error) return [];
    return (data ?? []) as unknown as HypothesisListItem[];
  } catch {
    return [];
  }
}

export async function getHypothesisBySlug(
  client: SupabaseClient,
  slug: string,
): Promise<HypothesisFull | null> {
  try {
    const { data, error } = await client
      .from("hypotheses")
      .select(
        `*,
         domain:domains(*),
         question:questions(id, slug, title),
         links:hypothesis_evidence(relation, weight, notes, created_at,
           evidence:evidence(*, source:sources(*))),
         history:confidence_history(*)`,
      )
      .eq("slug", slug)
      .maybeSingle();
    if (error || !data) return null;
    const full = data as unknown as HypothesisFull;
    full.history = [...(full.history ?? [])].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
    full.links = [...(full.links ?? [])].sort((a, b) => b.weight - a.weight);
    return full;
  } catch {
    return null;
  }
}

export async function getHypothesisById(
  client: SupabaseClient,
  id: string,
): Promise<HypothesisFull | null> {
  try {
    const { data, error } = await client
      .from("hypotheses")
      .select(
        `*,
         domain:domains(*),
         question:questions(id, slug, title),
         links:hypothesis_evidence(relation, weight, notes, created_at,
           evidence:evidence(*, source:sources(*))),
         history:confidence_history(*)`,
      )
      .eq("id", id)
      .maybeSingle();
    if (error || !data) return null;
    const full = data as unknown as HypothesisFull;
    full.history = [...(full.history ?? [])].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
    return full;
  } catch {
    return null;
  }
}

export async function listHypothesisSlugs(client: SupabaseClient): Promise<string[]> {
  try {
    const { data, error } = await client
      .from("hypotheses")
      .select("slug")
      .neq("state", "draft");
    if (error) return [];
    return ((data ?? []) as Array<{ slug: string }>).map((h) => h.slug);
  } catch {
    return [];
  }
}

export async function getSuggestedConfidence(
  client: SupabaseClient,
  hypothesisId: string,
): Promise<number | null> {
  try {
    const { data, error } = await client.rpc("suggested_confidence", {
      h_id: hypothesisId,
    });
    if (error || typeof data !== "number") return null;
    return data;
  } catch {
    return null;
  }
}

/** Fire-and-forget view counter; deliberately silent in the timeline. */
export async function incrementPopularity(
  client: SupabaseClient,
  hypothesisId: string,
): Promise<void> {
  try {
    await client.rpc("increment_popularity", { h_id: hypothesisId });
  } catch {
    /* a lost view tick is fine */
  }
}
