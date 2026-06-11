import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { publicClient } from "@/lib/supabase/public";
import {
  getHypothesisBySlug,
  getSuggestedConfidence,
  listHypothesisSlugs,
} from "@/lib/queries/hypotheses";
import { contradictionsForHypothesis } from "@/lib/queries/contradictions";
import { EpistemicBadge } from "@/components/epistemics/EpistemicBadge";
import { ConfidenceMeter } from "@/components/epistemics/ConfidenceMeter";
import { EvidenceBalance } from "@/components/epistemics/EvidenceBalance";
import { AssumptionList } from "@/components/epistemics/AssumptionList";
import { ContradictionFlag } from "@/components/epistemics/ContradictionFlag";
import { Markdown } from "@/components/Markdown";
import { ViewTracker } from "@/components/ViewTracker";
import { STATE_LABELS, STATUS_META } from "@/lib/knowledge-engine/taxonomy";
import { SITE_URL, formatDate, stripMarkdown, truncate } from "@/lib/utils";

export const revalidate = 3600; // ISR per-slug; on-demand revalidate on write

export async function generateStaticParams() {
  const slugs = await listHypothesisSlugs(publicClient);
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const h = await getHypothesisBySlug(publicClient, slug);
  if (!h) return { title: "Hypothesis not found" };
  const description = truncate(stripMarkdown(h.description), 160);
  // The per-slug opengraph-image.tsx is injected automatically by Next's file
  // convention, so we don't set openGraph.images here.
  return {
    title: h.title,
    description,
    openGraph: {
      title: h.title,
      description,
      type: "article",
      url: `${SITE_URL}/hypotheses/${slug}`,
    },
    twitter: { card: "summary_large_image" },
  };
}

export default async function HypothesisDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const h = await getHypothesisBySlug(publicClient, slug);
  if (!h) notFound();

  const [suggested, contradictions] = await Promise.all([
    getSuggestedConfidence(publicClient, h.id),
    contradictionsForHypothesis(publicClient, h.id),
  ]);

  const meta = STATUS_META[h.status];

  return (
    <article className="mx-auto max-w-content px-4 py-12 sm:px-6">
      <ViewTracker hypothesisId={h.id} />

      {/* Header */}
      <header className="space-y-5 border-b border-edge pb-8">
        <div className="flex flex-wrap items-center gap-3">
          <Link href={`/domains/${h.domain.slug}`} className="eyebrow hover:text-ink">
            {h.domain.name}
          </Link>
          {h.question && (
            <>
              <span className="text-muted">·</span>
              <Link href={`/questions/${h.question.slug}`} className="eyebrow hover:text-ink">
                {truncate(h.question.title, 60)}
              </Link>
            </>
          )}
        </div>

        <h1 className="max-w-3xl font-display text-2xl font-light leading-tight text-ink sm:text-3xl">
          {h.title}
        </h1>

        <div className="flex flex-wrap items-center gap-3">
          <EpistemicBadge status={h.status} />
          <span className="rounded border border-edge px-2 py-0.5 font-mono text-xs text-muted">
            {STATE_LABELS[h.state]}
          </span>
          <span className="font-mono text-xs text-muted">
            Updated {formatDate(h.updated_at)}
          </span>
          {h.actor_type === "agent" && h.agent_name && (
            <span className="font-mono text-xs text-muted">via {h.agent_name}</span>
          )}
        </div>
      </header>

      <div className="grid gap-10 py-10 lg:grid-cols-[1fr_320px]">
        {/* Main column */}
        <div className="space-y-10">
          <section>
            <Markdown>{h.description}</Markdown>
          </section>

          <ContradictionFlag contradictions={contradictions} selfId={h.id} />

          <EvidenceBalance links={h.links} />

          <section className="space-y-4">
            <h2 className="font-display text-lg font-medium text-ink">Assumptions</h2>
            <AssumptionList assumptions={h.assumptions} />
          </section>

          {h.open_questions.length > 0 && (
            <section className="space-y-4">
              <h2 className="font-display text-lg font-medium text-ink">
                Open questions within this hypothesis
              </h2>
              <ul className="space-y-2">
                {h.open_questions.map((q, i) => (
                  <li key={i} className="flex gap-2 text-sm text-muted">
                    <span aria-hidden className="text-accent">?</span>
                    {q.text}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="space-y-4">
            <h2 className="font-display text-lg font-medium text-ink">
              Falsification criteria
            </h2>
            {h.falsification_criteria.trim() ? (
              <div className="card border-l-2 border-l-accent p-5">
                <Markdown>{h.falsification_criteria}</Markdown>
              </div>
            ) : (
              <p className="text-sm text-muted">
                No falsification criteria recorded — a gap worth closing.
              </p>
            )}
          </section>
        </div>

        {/* Sidebar: the instrument */}
        <aside className="space-y-6">
          <div className="card space-y-4 p-6 lg:sticky lg:top-20">
            <div>
              <p className="eyebrow">Confidence</p>
              <p className="mt-1 text-xs text-muted">{meta.label}</p>
            </div>
            <ConfidenceMeter
              value={h.confidence}
              suggested={suggested}
              rationale={h.confidence_rationale}
              history={h.history}
              animate
            />
            <div className="space-y-2 border-t border-edge pt-4 font-mono text-xs text-muted">
              <div className="flex justify-between">
                <span>Permitted band</span>
                <span>{meta.min}–{meta.max}</span>
              </div>
              <div className="flex justify-between">
                <span>Evidence links</span>
                <span>{h.links.length}</span>
              </div>
              <div className="flex justify-between">
                <span>Confidence revisions</span>
                <span>{h.history.length}</span>
              </div>
              <div className="flex justify-between">
                <span>Views</span>
                <span>{h.popularity}</span>
              </div>
            </div>
          </div>

          <Link
            href={`/graph?focus=${h.slug}`}
            className="block rounded border border-edge bg-surface px-4 py-3 text-center text-sm text-ink transition-colors hover:bg-raised"
          >
            View in research graph →
          </Link>
        </aside>
      </div>
    </article>
  );
}
