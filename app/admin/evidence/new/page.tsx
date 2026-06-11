import { createClient } from "@/lib/supabase/server";
import { listDomains } from "@/lib/queries/domains";
import { EvidenceForm } from "@/components/admin/EvidenceForm";
import type { Source } from "@/types/domain";

export const metadata = { title: "Admin · New evidence" };

export default async function NewEvidencePage() {
  const supabase = await createClient();
  const [domains, sourcesRes] = await Promise.all([
    listDomains(supabase),
    supabase.from("sources").select("id, title, year").order("title"),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="font-display text-xl font-light text-ink">New evidence</h1>
      <EvidenceForm
        domains={domains}
        sources={(sourcesRes.data ?? []) as Array<Pick<Source, "id" | "title" | "year">>}
      />
    </div>
  );
}
