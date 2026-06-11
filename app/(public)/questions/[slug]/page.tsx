import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { publicClient } from "@/lib/supabase/public";
import {
  getQuestionBySlug,
  listQuestionSlugs,
} from "@/lib/queries/questions";
import { PageHeader } from "@/components/layout/PageHeader";
import { EpistemicBadge } from "@/components/epistemics/EpistemicBadge";
import { HypothesisCard } from "@/components/epistemics/HypothesisCard";
import { Markdown } from "@/components/Markdown";
import { STATUS_META } from "@/lib/knowledge-engine/taxonomy";
import { stripMarkdown, truncate } from "@/lib/utils";

export const revalidate = 3600;

export async function generateStaticParams() {
  const slugs = await listQuestionSlugs(publicClient);
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const q = await getQuestionBySlug(publicClient, slug);
  if (!q) return { title: "Question not found" };
  return {
    title: q.title,
    description: truncate(stripMarkdown(q.description) || q.title, 160),
  };
}

export default async function QuestionDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const q = await getQuestionBySlug(publicClient, slug);
  if (!q) notFound();

  const meta = STATUS_META[q.status];

  return (
    <div className="mx-auto max-w-content space-y-10 px-4 py-12 sm:px-6">
      <PageHeader
        eyebrow={q.domain ? q.domain.name : "Question"}
        title={q.title}
        description={
          <div className="flex flex-wrap items-center gap-3">
            <EpistemicBadge status={q.status} />
            <span className="font-mono text-xs text-muted">
              importance {q.importance}/100 · {meta.label}
            </span>
          </div>
        }
      />

      {q.description && (
        <section className="max-w-3xl">
          <Markdown>{q.description}</Markdown>
        </section>
      )}

      <div className="grid gap-8 lg:grid-cols-2">
        {q.current_explanations && (
          <section className="card p-6">
            <p className="eyebrow pb-3">Current explanations</p>
            <Markdown>{q.current_explanations}</Markdown>
          </section>
        )}
        {q.research_progress && (
          <section className="card p-6">
            <p className="eyebrow pb-3">Research progress</p>
            <Markdown>{q.research_progress}</Markdown>
          </section>
        )}
      </div>

      <section className="space-y-5">
        <h2 className="font-display text-lg font-medium text-ink">
          Candidate hypotheses ({q.hypotheses.length})
        </h2>
        {q.hypotheses.length === 0 ? (
          <p className="text-sm text-muted">
            No hypotheses are linked to this question yet.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {q.hypotheses.map((h) => (
              <HypothesisCard key={h.id} hypothesis={h} />
            ))}
          </div>
        )}
      </section>

      <Link href="/questions" className="link text-sm">
        ← All questions
      </Link>
    </div>
  );
}
