import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  EpistemicStatus,
  QuestionFull,
  QuestionWithDomain,
} from "@/types/domain";
import { logQueryError, logQueryThrow } from "./log";

export interface QuestionFilters {
  domainSlug?: string;
  status?: EpistemicStatus;
  sort?: "importance" | "updated";
  limit?: number;
}

export async function listQuestions(
  client: SupabaseClient,
  filters: QuestionFilters = {},
): Promise<QuestionWithDomain[]> {
  try {
    const embed = filters.domainSlug
      ? "*, domain:domains!inner(id, slug, name)"
      : "*, domain:domains(id, slug, name)";
    let query = client.from("questions").select(embed);

    if (filters.domainSlug) query = query.eq("domain.slug", filters.domainSlug);
    if (filters.status) query = query.eq("status", filters.status);

    query =
      filters.sort === "updated"
        ? query.order("updated_at", { ascending: false })
        : query.order("importance", { ascending: false });

    const { data, error } = await query.limit(filters.limit ?? 200);
    if (error) return logQueryError("listQuestions", error, []);
    return (data ?? []) as unknown as QuestionWithDomain[];
  } catch (err) {
    return logQueryThrow("listQuestions", err, []);
  }
}

export async function getQuestionBySlug(
  client: SupabaseClient,
  slug: string,
): Promise<QuestionFull | null> {
  try {
    const { data, error } = await client
      .from("questions")
      .select(
        `*,
         domain:domains(id, slug, name),
         hypotheses(*, domain:domains(id, slug, name))`,
      )
      .eq("slug", slug)
      .maybeSingle();
    if (error) return logQueryError("getQuestionBySlug", error, null);
    if (!data) return null;
    const full = data as unknown as QuestionFull;
    full.hypotheses = (full.hypotheses ?? [])
      .filter((h) => h.state !== "draft")
      .sort((a, b) => b.confidence - a.confidence);
    return full;
  } catch (err) {
    return logQueryThrow("getQuestionBySlug", err, null);
  }
}

export async function listQuestionSlugs(client: SupabaseClient): Promise<string[]> {
  try {
    const { data, error } = await client.from("questions").select("slug");
    if (error) return logQueryError("listQuestionSlugs", error, []);
    return ((data ?? []) as Array<{ slug: string }>).map((q) => q.slug);
  } catch (err) {
    return logQueryThrow("listQuestionSlugs", err, []);
  }
}
