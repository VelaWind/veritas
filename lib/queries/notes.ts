import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResearchNote } from "@/types/domain";

/** RLS already hides unpublished notes from anonymous readers. */
export async function listNotes(client: SupabaseClient): Promise<ResearchNote[]> {
  try {
    const { data, error } = await client
      .from("research_notes")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) return [];
    return (data ?? []) as ResearchNote[];
  } catch {
    return [];
  }
}

export async function getNoteBySlug(
  client: SupabaseClient,
  slug: string,
): Promise<ResearchNote | null> {
  try {
    const { data, error } = await client
      .from("research_notes")
      .select("*")
      .eq("slug", slug)
      .maybeSingle();
    if (error) return null;
    return (data as ResearchNote) ?? null;
  } catch {
    return null;
  }
}

export async function listNoteSlugs(client: SupabaseClient): Promise<string[]> {
  try {
    const { data, error } = await client
      .from("research_notes")
      .select("slug")
      .eq("published", true);
    if (error) return [];
    return ((data ?? []) as Array<{ slug: string }>).map((n) => n.slug);
  } catch {
    return [];
  }
}
