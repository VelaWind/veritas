import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResearchNote } from "@/types/domain";
import { logQueryError, logQueryThrow } from "./log";

/** RLS already hides unpublished notes from anonymous readers. */
export async function listNotes(client: SupabaseClient): Promise<ResearchNote[]> {
  try {
    const { data, error } = await client
      .from("research_notes")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) return logQueryError("listNotes", error, []);
    return (data ?? []) as ResearchNote[];
  } catch (err) {
    return logQueryThrow("listNotes", err, []);
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
    if (error) return logQueryError("getNoteBySlug", error, null);
    return (data as ResearchNote) ?? null;
  } catch (err) {
    return logQueryThrow("getNoteBySlug", err, null);
  }
}

export async function listNoteSlugs(client: SupabaseClient): Promise<string[]> {
  try {
    const { data, error } = await client
      .from("research_notes")
      .select("slug")
      .eq("published", true);
    if (error) return logQueryError("listNoteSlugs", error, []);
    return ((data ?? []) as Array<{ slug: string }>).map((n) => n.slug);
  } catch (err) {
    return logQueryThrow("listNoteSlugs", err, []);
  }
}
