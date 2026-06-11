import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { publicClient } from "@/lib/supabase/public";
import {
  getEvidenceBySlug,
  listEvidenceSlugs,
} from "@/lib/queries/evidence";
import { PageHeader } from "@/components/layout/PageHeader";
import { EpistemicBadge } from "@/components/epistemics/EpistemicBadge";
import { Markdown } from "@/components/Markdown";
import { SOURCE_TYPE_LABELS } from "@/lib/knowledge-engine/sources";
import { stripMarkdown, truncate } from "@/lib/utils";

export const revalidate = 3600;

export async function generateStaticParams() {
  const slugs = await listEvidenceSlugs(publicClient);
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const e = await getEvidenceBySlug(publicClient, slug);
  if (!e) return { title: "Evidence not found" };
  return {
    title: e.title,
    description: truncate(stripMarkdown(e.summary), 160),
  };
}

const RELATION_COLOR: Record<string, string> = {
  supports: "var(--signal-strong)",
  opposes: "var(--contradiction)",
  neutral: "var(--text-muted)",
};

export default async function EvidenceDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const e = await getEvidenceBySlug(publicClient, slug);
  if (!e) notFound();

  return (
    <div className="mx-auto max-w-content space-y-10 px-4 py-12 sm:px-6">
      <PageHeader
        eyebrow={e.domain ? e.domain.name : "Evidence"}
        title={e.title}
        actions={
          <div className="text-right font-mono text-xs text-muted">
            <p className="text-ink">strength {e.strength}/100</p>
            {e.source && <p>{SOURCE_TYPE_LABELS[e.source.source_type]}</p>}
          </div>
        }
      />

      <div className="grid gap-10 lg:grid-cols-[1fr_320px]">
        <div className="space-y-8">
          <section>
            <Markdown>{e.summary}</Markdown>
          </section>

          <section className="space-y-4">
            <h2 className="font-display text-lg font-medium text-ink">
              Bears on {e.linked_hypotheses.length} hypothes
              {e.linked_hypotheses.length === 1 ? "is" : "es"}
            </h2>
            {e.linked_hypotheses.length === 0 ? (
              <p className="text-sm text-muted">
                Not yet linked to any hypothesis.
              </p>
            ) : (
              <ul className="space-y-3">
                {e.linked_hypotheses.map((l) =>
                  l.hypothesis ? (
                    <li key={l.hypothesis.id} className="card p-4">
                      <div className="flex flex-wrap items-center gap-3">
                        <span
                          className="font-mono text-xs uppercase tracking-wider"
                          style={{ color: RELATION_COLOR[l.relation] }}
                        >
                          {l.relation}
                        </span>
                        <span className="font-mono text-xs text-muted">w{l.weight}</span>
                        <EpistemicBadge status={l.hypothesis.status} />
                      </div>
                      <Link
                        href={`/hypotheses/${l.hypothesis.slug}`}
                        className="mt-2 block font-display text-base text-ink hover:text-accent"
                      >
                        {l.hypothesis.title}
                      </Link>
                      {l.notes && <p className="mt-1 text-sm text-muted">{l.notes}</p>}
                    </li>
                  ) : null,
                )}
              </ul>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          {e.source ? (
            <div className="card space-y-3 p-6">
              <p className="eyebrow">Source</p>
              <p className="font-display text-base text-ink">{e.source.title}</p>
              {e.source.authors && (
                <p className="text-sm text-muted">{e.source.authors}</p>
              )}
              <dl className="space-y-1.5 border-t border-edge pt-3 font-mono text-xs text-muted">
                <div className="flex justify-between">
                  <dt>Type</dt>
                  <dd className="text-ink">{SOURCE_TYPE_LABELS[e.source.source_type]}</dd>
                </div>
                {e.source.year && (
                  <div className="flex justify-between">
                    <dt>Year</dt>
                    <dd className="text-ink">{e.source.year}</dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt>Reliability</dt>
                  <dd className="text-ink">{e.source.reliability}/100</dd>
                </div>
                {e.source.doi && (
                  <div className="flex justify-between gap-2">
                    <dt>DOI</dt>
                    <dd className="truncate text-ink">{e.source.doi}</dd>
                  </div>
                )}
              </dl>
              {e.source.url && (
                <a
                  href={e.source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-accent hover:underline"
                >
                  Visit source <ExternalLink size={13} aria-hidden />
                </a>
              )}
            </div>
          ) : (
            <div className="card p-6 text-sm text-muted">
              No formal source attached to this evidence.
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
