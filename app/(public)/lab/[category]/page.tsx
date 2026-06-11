import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { publicClient } from "@/lib/supabase/public";
import { listSimulationsWithRuns } from "@/lib/queries/simulations";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { SimulationMetricsChart } from "@/components/charts/SimulationMetricsChart";
import { Markdown } from "@/components/Markdown";
import {
  CATEGORY_BY_SLUG,
  CATEGORY_META,
  SIM_STATUS_LABEL,
} from "@/lib/knowledge-engine/simulations";
import { formatDate } from "@/lib/utils";

export const revalidate = 3600;

export function generateStaticParams() {
  return CATEGORY_META.map((c) => ({ category: c.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }>;
}): Promise<Metadata> {
  const { category } = await params;
  const meta = CATEGORY_META.find((c) => c.slug === category);
  if (!meta) return { title: "Category not found" };
  return { title: meta.title, description: meta.blurb };
}

export default async function LabCategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const { category } = await params;
  const meta = CATEGORY_META.find((c) => c.slug === category);
  const dbCategory = CATEGORY_BY_SLUG[category];
  if (!meta || !dbCategory) notFound();

  const simulations = await listSimulationsWithRuns(publicClient, dbCategory);

  return (
    <div className="mx-auto max-w-content space-y-10 px-4 py-12 sm:px-6">
      <PageHeader eyebrow="Simulation Lab" title={meta.title} description={meta.blurb} />

      <Link href="/lab" className="link text-sm">
        ← All categories
      </Link>

      {simulations.length === 0 ? (
        <EmptyState
          title="No simulations in this category yet"
          description="Catalog entries and their recorded runs will appear here."
        />
      ) : (
        <div className="space-y-8">
          {simulations.map((sim) => (
            <section key={sim.id} className="card p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-display text-lg font-medium text-ink">{sim.title}</h2>
                  {sim.description && (
                    <div className="mt-2 max-w-2xl text-sm text-muted">
                      <Markdown>{sim.description}</Markdown>
                    </div>
                  )}
                </div>
                <Badge>{SIM_STATUS_LABEL[sim.status]}</Badge>
              </div>

              {Object.keys(sim.parameters).length > 0 && (
                <div className="mt-4">
                  <p className="eyebrow pb-1.5">Parameters</p>
                  <pre className="overflow-x-auto rounded border border-edge bg-void p-3 font-mono text-xs text-muted">
                    {JSON.stringify(sim.parameters, null, 2)}
                  </pre>
                </div>
              )}

              <div className="mt-5 border-t border-edge pt-5">
                <p className="eyebrow pb-3">
                  Recorded runs ({sim.runs.length})
                </p>
                {sim.runs.length === 0 ? (
                  <p className="text-sm text-muted">No runs recorded yet.</p>
                ) : (
                  <div className="space-y-6">
                    {sim.runs.map((run) => (
                      <div key={run.id} className="rounded border border-edge p-4">
                        <div className="flex flex-wrap items-center gap-3 pb-3 font-mono text-xs text-muted">
                          <span className="text-ink">run {run.id.slice(0, 8)}</span>
                          {run.started_at && <span>started {formatDate(run.started_at)}</span>}
                          <span>
                            {run.finished_at
                              ? `finished ${formatDate(run.finished_at)}`
                              : "in progress"}
                          </span>
                        </div>
                        <SimulationMetricsChart metrics={run.metrics} />
                        {Object.keys(run.results).length > 0 && (
                          <pre className="mt-3 overflow-x-auto rounded border border-edge bg-void p-3 font-mono text-xs text-muted">
                            {JSON.stringify(run.results, null, 2)}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
