import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { listQuestions } from "@/lib/queries/questions";
import { EpistemicBadge } from "@/components/epistemics/EpistemicBadge";
import { Button } from "@/components/ui/Button";

export const metadata = { title: "Admin · Questions" };

export default async function AdminQuestionsPage() {
  const supabase = await createClient();
  const questions = await listQuestions(supabase, { sort: "importance" });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-display text-xl font-light text-ink">Questions</h1>
        <Link href="/admin/questions/new">
          <Button variant="primary">New question</Button>
        </Link>
      </div>

      {questions.length === 0 ? (
        <p className="card p-8 text-center text-sm text-muted">No questions yet.</p>
      ) : (
        <ul className="card divide-y divide-edge">
          {questions.map((q) => (
            <li key={q.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="font-mono text-xs text-muted">i{q.importance}</span>
              <Link
                href={`/admin/questions/${q.id}`}
                className="min-w-0 flex-1 text-sm text-ink hover:text-accent"
              >
                {q.title}
              </Link>
              <span className="font-mono text-xs text-muted">{q.domain?.name}</span>
              <EpistemicBadge status={q.status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
