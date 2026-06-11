import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NoteForm } from "@/components/admin/NoteForm";
import type { ResearchNote } from "@/types/domain";

export const metadata = { title: "Admin · Edit note" };

export default async function EditNotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("research_notes")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();

  return (
    <div className="space-y-6">
      <h1 className="font-display text-xl font-light text-ink">Edit note</h1>
      <NoteForm initial={data as ResearchNote} />
    </div>
  );
}
