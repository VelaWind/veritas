import { createClient } from "@/lib/supabase/server";
import { listDomains } from "@/lib/queries/domains";
import { EvidenceForm } from "@/components/admin/EvidenceForm";
import type { Source } from "@/types/domain";

export const metadata = { title: "Contribute · Propose evidence" };

export default async function ProposeEvidencePage() {
  const supabase = await createClient();
  const [domains, sourcesRes] = await Promise.all([
    listDomains(supabase),
    supabase.from("sources").select("id, title, year").order("title"),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-xl font-light text-ink">Propose evidence</h1>
        <p className="mt-1 text-sm text-muted">
          Submitted for admin review — not published directly.
        </p>
      </div>
      <EvidenceForm
        propose
        domains={domains}
        sources={(sourcesRes.data ?? []) as Array<Pick<Source, "id" | "title" | "year">>}
      />
    </div>
  );
}
