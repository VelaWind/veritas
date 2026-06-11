import type { SupabaseClient } from "@supabase/supabase-js";
import type { Domain } from "@/types/domain";

export interface DomainWithCounts extends Domain {
  hypothesis_count: number;
  question_count: number;
  evidence_count: number;
}

export async function listDomains(client: SupabaseClient): Promise<Domain[]> {
  try {
    const { data, error } = await client
      .from("domains")
      .select("*")
      .order("sort_order", { ascending: true });
    if (error) return [];
    return (data ?? []) as Domain[];
  } catch {
    return [];
  }
}

export async function listDomainsWithCounts(
  client: SupabaseClient,
): Promise<DomainWithCounts[]> {
  try {
    const { data, error } = await client
      .from("domains")
      .select("*, hypotheses(count), questions(count), evidence(count)")
      .order("sort_order", { ascending: true });
    if (error) return [];
    type Raw = Domain & {
      hypotheses: Array<{ count: number }>;
      questions: Array<{ count: number }>;
      evidence: Array<{ count: number }>;
    };
    return ((data ?? []) as Raw[]).map(({ hypotheses, questions, evidence, ...d }) => ({
      ...d,
      hypothesis_count: hypotheses?.[0]?.count ?? 0,
      question_count: questions?.[0]?.count ?? 0,
      evidence_count: evidence?.[0]?.count ?? 0,
    }));
  } catch {
    return [];
  }
}

export async function getDomainBySlug(
  client: SupabaseClient,
  slug: string,
): Promise<Domain | null> {
  try {
    const { data, error } = await client
      .from("domains")
      .select("*")
      .eq("slug", slug)
      .maybeSingle();
    if (error) return null;
    return (data as Domain) ?? null;
  } catch {
    return null;
  }
}

export async function listDomainSlugs(client: SupabaseClient): Promise<string[]> {
  try {
    const { data, error } = await client.from("domains").select("slug");
    if (error) return [];
    return ((data ?? []) as Array<{ slug: string }>).map((d) => d.slug);
  } catch {
    return [];
  }
}
