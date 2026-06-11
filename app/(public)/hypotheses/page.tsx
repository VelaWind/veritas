import type { Metadata } from "next";
import { publicClient } from "@/lib/supabase/public";
import { listDomains } from "@/lib/queries/domains";
import {
  listHypotheses,
  type HypothesisFilters as Filters,
} from "@/lib/queries/hypotheses";
import { PageHeader } from "@/components/layout/PageHeader";
import { HypothesisFilters } from "@/components/HypothesisFilters";
import { HypothesisCard } from "@/components/epistemics/HypothesisCard";
import { EmptyState } from "@/components/ui/EmptyState";
import type { EpistemicStatus } from "@/types/domain";

// Dynamic RSC: filtered lists are live (§1.3).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Hypothesis database",
  description:
    "Every hypothesis Veritas tracks, with its epistemic status and confidence — filterable by domain, status, and strength of support.",
};

const SORTS = ["confidence", "updated", "created", "popularity"] as const;

export default async function HypothesesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const domainSlug = typeof sp.domain === "string" ? sp.domain : undefined;
  const status = typeof sp.status === "string" ? (sp.status as EpistemicStatus) : undefined;
  const minConfidence =
    typeof sp.minConfidence === "string" ? Number(sp.minConfidence) : undefined;
  const sortParam = typeof sp.sort === "string" ? sp.sort : "confidence";
  const sort = (SORTS as readonly string[]).includes(sortParam)
    ? (sortParam as Filters["sort"])
    : "confidence";

  const [domains, hypotheses] = await Promise.all([
    listDomains(publicClient),
    listHypotheses(publicClient, { domainSlug, status, minConfidence, sort }),
  ]);

  return (
    <div className="mx-auto max-w-content space-y-8 px-4 py-12 sm:px-6">
      <PageHeader
        eyebrow="The knowledge map"
        title="Hypothesis database"
        description="Each card shows its epistemic status and a confidence score bounded by that status. Filters are live."
      />

      <HypothesisFilters domains={domains} />

      <p className="font-mono text-xs text-muted">
        {hypotheses.length} hypothes{hypotheses.length === 1 ? "is" : "es"}
      </p>

      {hypotheses.length === 0 ? (
        <EmptyState
          title="No hypotheses match"
          description="Try widening the filters, or clear them to see the whole map."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {hypotheses.map((h) => (
            <HypothesisCard key={h.id} hypothesis={h} />
          ))}
        </div>
      )}
    </div>
  );
}
