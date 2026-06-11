import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listDomains } from "@/lib/queries/domains";
import { QuestionForm } from "@/components/admin/QuestionForm";
import type { Question } from "@/types/domain";

export const metadata = { title: "Admin · Edit question" };

export default async function EditQuestionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const [{ data }, domains] = await Promise.all([
    supabase.from("questions").select("*").eq("id", id).maybeSingle(),
    listDomains(supabase),
  ]);
  if (!data) notFound();

  return (
    <div className="space-y-6">
      <h1 className="font-display text-xl font-light text-ink">Edit question</h1>
      <QuestionForm domains={domains} initial={data as Question} />
    </div>
  );
}
