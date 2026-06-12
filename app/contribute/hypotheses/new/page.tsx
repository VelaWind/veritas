import { createClient } from "@/lib/supabase/server";
import { listDomains } from "@/lib/queries/domains";
import { HypothesisForm } from "@/components/admin/HypothesisForm";

export const metadata = { title: "Contribute · Propose hypothesis" };

export default async function ProposeHypothesisPage() {
  const supabase = await createClient();
  const [domains, questionsRes] = await Promise.all([
    listDomains(supabase),
    supabase
      .from("questions")
      .select("id, title, domain_id")
      .order("importance", { ascending: false }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-xl font-light text-ink">
          Propose a hypothesis
        </h1>
        <p className="mt-1 text-sm text-muted">
          Submitted for admin review — not published directly.
        </p>
      </div>
      <HypothesisForm
        propose
        domains={domains}
        questions={(questionsRes.data ?? []) as Array<{
          id: string;
          title: string;
          domain_id: string;
        }>}
      />
    </div>
  );
}
