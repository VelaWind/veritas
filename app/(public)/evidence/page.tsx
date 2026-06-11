import type { Metadata } from "next";
import { publicClient } from "@/lib/supabase/public";
import { listEvidence } from "@/lib/queries/evidence";
import { PageHeader } from "@/components/layout/PageHeader";
import { EvidenceCard } from "@/components/epistemics/EvidenceCard";
import { EmptyState } from "@/components/ui/EmptyState";
import type { SourceType } from "@/types/domain";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Evidence library",
  description:
    "Every piece of evidence Veritas tracks, drawn from real citable sources and linked to the hypotheses it bears on.",
};

export default async function EvidencePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const domainSlug = typeof sp.domain === "string" ? sp.domain : undefined;
  const sourceType =
    typeof sp.sourceType === "string" ? (sp.sourceType as SourceType) : undefined;

  const evidence = await listEvidence(publicClient, {
    domainSlug,
    sourceType,
    limit: 300,
  });

  return (
    <div className="mx-auto max-w-content space-y-8 px-4 py-12 sm:px-6">
      <PageHeader
        eyebrow="The record"
        title="Evidence library"
        description="Evidence is rated by strength and linked supportively or oppositionally to hypotheses. The same evidence can cut both ways."
      />

      <p className="font-mono text-xs text-muted">
        {evidence.length} entr{evidence.length === 1 ? "y" : "ies"}
      </p>

      {evidence.length === 0 ? (
        <EmptyState
          title="No evidence yet"
          description="Once seeded, ~30 real, citable evidence entries appear here."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {evidence.map((e) => (
            <EvidenceCard key={e.id} evidence={e} />
          ))}
        </div>
      )}
    </div>
  );
}
