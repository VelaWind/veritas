import type { Metadata } from "next";
import Link from "next/link";
import { publicClient } from "@/lib/supabase/public";
import { listQuestions } from "@/lib/queries/questions";
import { PageHeader } from "@/components/layout/PageHeader";
import { EpistemicBadge } from "@/components/epistemics/EpistemicBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { stripMarkdown, truncate } from "@/lib/utils";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Unanswered questions",
  description:
    "The open questions Veritas tracks — ranked by importance, each charting how far we are from an answer.",
};

export default async function QuestionsPage() {
  const questions = await listQuestions(publicClient, { sort: "importance" });

  return (
    <div className="mx-auto max-w-content space-y-8 px-4 py-12 sm:px-6">
      <PageHeader
        eyebrow="The frontier"
        title="Unanswered questions"
        description="Some of these may never be answered. Their epistemic status records how settled — or unsettled — the answer currently is."
      />

      {questions.length === 0 ? (
        <EmptyState
          title="No questions yet"
          description="Once seeded, ~20 canonical open questions appear here."
        />
      ) : (
        <ul className="space-y-3">
          {questions.map((q) => (
            <li key={q.id}>
              <Link
                href={`/questions/${q.slug}`}
                className="card group flex flex-col gap-3 p-6 transition-colors hover:bg-raised"
              >
                <div className="flex items-start justify-between gap-4">
                  <h2 className="font-display text-lg font-light text-ink group-hover:text-accent">
                    {q.title}
                  </h2>
                  <EpistemicBadge status={q.status} />
                </div>
                {q.description && (
                  <p className="text-sm text-muted">
                    {truncate(stripMarkdown(q.description), 200)}
                  </p>
                )}
                <div className="flex items-center gap-3 font-mono text-xs text-muted">
                  {q.domain && <span>{q.domain.name}</span>}
                  <span>· importance {q.importance}/100</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
