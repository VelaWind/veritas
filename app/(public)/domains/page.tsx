import type { Metadata } from "next";
import Link from "next/link";
import { publicClient } from "@/lib/supabase/public";
import { listDomainsWithCounts } from "@/lib/queries/domains";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Domains",
  description: "The ten domains of inquiry mapped by Veritas.",
};

export default async function DomainsPage() {
  const domains = await listDomainsWithCounts(publicClient);

  return (
    <div className="mx-auto max-w-content space-y-10 px-4 py-12 sm:px-6">
      <PageHeader
        eyebrow="Ten regions of inquiry"
        title="Domains"
        description="Each domain gathers the questions, hypotheses, and evidence for one frontier of understanding."
      />

      {domains.length === 0 ? (
        <EmptyState
          title="No domains yet"
          description="Once the database is seeded, the ten domains appear here."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {domains.map((d) => (
            <Link
              key={d.id}
              href={`/domains/${d.slug}`}
              className="card group flex flex-col gap-3 p-6 transition-colors hover:bg-raised"
            >
              <h2 className="font-display text-lg font-medium text-ink group-hover:text-accent">
                {d.name}
              </h2>
              <p className="text-sm text-muted">{d.overview}</p>
              <div className="mt-auto flex gap-4 pt-2 font-mono text-xs text-muted">
                <span>{d.hypothesis_count} hypotheses</span>
                <span>{d.question_count} questions</span>
                <span>{d.evidence_count} evidence</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
