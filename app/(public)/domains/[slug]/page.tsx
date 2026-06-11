import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { publicClient } from "@/lib/supabase/public";
import {
  getDomainBySlug,
  listDomainSlugs,
} from "@/lib/queries/domains";
import { listHypotheses } from "@/lib/queries/hypotheses";
import { listQuestions } from "@/lib/queries/questions";
import { listEvidence } from "@/lib/queries/evidence";
import { PageHeader } from "@/components/layout/PageHeader";
import { HypothesisCard } from "@/components/epistemics/HypothesisCard";
import { EvidenceCard } from "@/components/epistemics/EvidenceCard";
import { EpistemicBadge } from "@/components/epistemics/EpistemicBadge";
import { Markdown } from "@/components/Markdown";
import { stripMarkdown, truncate } from "@/lib/utils";

export const revalidate = 3600;

export async function generateStaticParams() {
  const slugs = await listDomainSlugs(publicClient);
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const domain = await getDomainBySlug(publicClient, slug);
  if (!domain) return { title: "Domain not found" };
  return {
    title: domain.name,
    description: truncate(stripMarkdown(domain.overview) || domain.name, 160),
  };
}

export default async function DomainDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const domain = await getDomainBySlug(publicClient, slug);
  if (!domain) notFound();

  const [hypotheses, questions, evidence] = await Promise.all([
    listHypotheses(publicClient, { domainSlug: slug, sort: "confidence" }),
    listQuestions(publicClient, { domainSlug: slug, sort: "importance" }),
    listEvidence(publicClient, { domainSlug: slug, limit: 12 }),
  ]);

  return (
    <div className="mx-auto max-w-content space-y-12 px-4 py-12 sm:px-6">
      <PageHeader eyebrow="Domain" title={domain.name} description={domain.overview} />

      {domain.research_status && (
        <section className="card p-6">
          <p className="eyebrow pb-3">State of the field</p>
          <Markdown>{domain.research_status}</Markdown>
        </section>
      )}

      <section className="space-y-5">
        <div className="flex items-end justify-between">
          <h2 className="font-display text-lg font-medium text-ink">
            Open questions ({questions.length})
          </h2>
        </div>
        {questions.length === 0 ? (
          <p className="text-sm text-muted">No questions recorded in this domain yet.</p>
        ) : (
          <ul className="card divide-y divide-edge">
            {questions.map((q) => (
              <li key={q.id}>
                <Link
                  href={`/questions/${q.slug}`}
                  className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-raised"
                >
                  <span className="font-display text-ink">{q.title}</span>
                  <span className="ml-auto shrink-0">
                    <EpistemicBadge status={q.status} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-5">
        <h2 className="font-display text-lg font-medium text-ink">
          Hypotheses ({hypotheses.length})
        </h2>
        {hypotheses.length === 0 ? (
          <p className="text-sm text-muted">No hypotheses recorded in this domain yet.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {hypotheses.map((h) => (
              <HypothesisCard key={h.id} hypothesis={h} />
            ))}
          </div>
        )}
      </section>

      {evidence.length > 0 && (
        <section className="space-y-5">
          <div className="flex items-end justify-between">
            <h2 className="font-display text-lg font-medium text-ink">
              Recent evidence
            </h2>
            <Link href={`/evidence?domain=${slug}`} className="link text-sm">
              All evidence →
            </Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {evidence.map((e) => (
              <EvidenceCard key={e.id} evidence={e} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
