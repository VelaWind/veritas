import { createClient } from "@/lib/supabase/server";
import { listDomains } from "@/lib/queries/domains";
import { HypothesisForm } from "@/components/admin/HypothesisForm";

export const metadata = { title: "Admin · New hypothesis" };

export default async function NewHypothesisPage() {
  const supabase = await createClient();
  const [domains, questionsRes] = await Promise.all([
    listDomains(supabase),
    supabase.from("questions").select("id, title, domain_id").order("importance", {
      ascending: false,
    }),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="font-display text-xl font-light text-ink">New hypothesis</h1>
      <HypothesisForm
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
