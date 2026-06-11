import { createClient } from "@/lib/supabase/server";
import { listDomains } from "@/lib/queries/domains";
import { QuestionForm } from "@/components/admin/QuestionForm";

export const metadata = { title: "Admin · New question" };

export default async function NewQuestionPage() {
  const supabase = await createClient();
  const domains = await listDomains(supabase);

  return (
    <div className="space-y-6">
      <h1 className="font-display text-xl font-light text-ink">New question</h1>
      <QuestionForm domains={domains} />
    </div>
  );
}
