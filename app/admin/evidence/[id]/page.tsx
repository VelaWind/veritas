import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listDomains } from "@/lib/queries/domains";
import { EvidenceForm } from "@/components/admin/EvidenceForm";
import type { Evidence, Source } from "@/types/domain";

export const metadata = { title: "Admin · Edit evidence" };

export default async function EditEvidencePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const [{ data }, domains, sourcesRes] = await Promise.all([
    supabase.from("evidence").select("*").eq("id", id).maybeSingle(),
    listDomains(supabase),
    supabase.from("sources").select("id, title, year").order("title"),
  ]);
  if (!data) notFound();

  return (
    <div className="space-y-6">
      <h1 className="font-display text-xl font-light text-ink">Edit evidence</h1>
      <EvidenceForm
        domains={domains}
        sources={(sourcesRes.data ?? []) as Array<Pick<Source, "id" | "title" | "year">>}
        initial={data as Evidence}
      />
    </div>
  );
}
