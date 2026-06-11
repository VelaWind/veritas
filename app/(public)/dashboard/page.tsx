import type { Metadata } from "next";
import Link from "next/link";
import { publicClient } from "@/lib/supabase/public";
import { getDashboardStats } from "@/lib/queries/stats";
import { listContradictions } from "@/lib/queries/contradictions";
import { listTimeline } from "@/lib/queries/timeline";
import { PageHeader } from "@/components/layout/PageHeader";
import { Stat } from "@/components/ui/Stat";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConfidenceDistribution } from "@/components/charts/ConfidenceDistribution";
import { DomainActivity } from "@/components/charts/DomainActivity";
import { TimelineEventRow } from "@/components/TimelineEventRow";
import { formatDateTime } from "@/lib/utils";

export const revalidate = 900; // §1.3: dashboard ISR 15 min

export const metadata: Metadata = {
  title: "Reality Dashboard",
  description:
    "The state of the map at a glance: confidence distribution, activity by domain, open contradictions, and recent change.",
};

export default async function DashboardPage() {
  const [stats, contradictions, timeline] = await Promise.all([
    getDashboardStats(publicClient),
    listContradictions(publicClient, { resolved: false }),
    listTimeline(publicClient, { limit: 12 }),
  ]);

  if (!stats) {
    return (
      <div className="mx-auto max-w-content space-y-8 px-4 py-12 sm:px-6">
        <PageHeader eyebrow="Instrument" title="Reality Dashboard" />
        <EmptyState
          title="No statistics yet"
          description="The dashboard reads a materialized view. Apply the migration and seed, then refresh stats from the admin panel."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-content space-y-10 px-4 py-12 sm:px-6">
      <PageHeader
        eyebrow="Instrument"
        title="Reality Dashboard"
        description="A summary of what the map currently holds. Uncertainty is a first-class quantity here."
        actions={
          <span className="font-mono text-xs text-muted">
            refreshed {formatDateTime(stats.refreshed_at)}
          </span>
        }
      />

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat value={stats.total_hypotheses} label="Hypotheses" />
        <Stat value={stats.total_evidence} label="Evidence entries" />
        <Stat value={stats.open_questions} label="Open questions" accent />
        <Stat value={stats.open_contradictions} label="Open contradictions" />
        <Stat value={stats.total_simulation_runs} label="Simulation runs" />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-6">
          <p className="eyebrow pb-1">Confidence distribution</p>
          <p className="pb-4 text-sm text-muted">
            How many hypotheses sit in each confidence band. An honest map keeps
            most of its weight away from the extremes.
          </p>
          <ConfidenceDistribution distribution={stats.confidence_distribution} />
        </section>

        <section className="card p-6">
          <p className="eyebrow pb-1">Activity by domain</p>
          <p className="pb-4 text-sm text-muted">
            Where hypotheses are concentrated across the ten domains.
          </p>
          <DomainActivity data={stats.activity_by_domain} />
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-6">
          <div className="flex items-center justify-between pb-4">
            <p className="eyebrow">Open contradictions</p>
            <Link href="/hypotheses" className="link text-xs">
              Browse hypotheses →
            </Link>
          </div>
          {contradictions.length === 0 ? (
            <p className="text-sm text-muted">
              No open contradictions. The evidence is currently consistent.
            </p>
          ) : (
            <ul className="space-y-3">
              {contradictions.slice(0, 6).map((c) => (
                <li
                  key={c.id}
                  className="border-l-2 pl-3"
                  style={{ borderLeftColor: "var(--contradiction)" }}
                >
                  <p className="text-sm text-ink">{c.explanation}</p>
                  <p className="mt-1 flex flex-wrap gap-1.5 font-mono text-xs text-muted">
                    {c.a && (
                      <Link href={`/hypotheses/${c.a.slug}`} className="hover:text-accent">
                        {c.a.title}
                      </Link>
                    )}
                    <span>↔</span>
                    {c.b && (
                      <Link href={`/hypotheses/${c.b.slug}`} className="hover:text-accent">
                        {c.b.title}
                      </Link>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-6">
          <div className="flex items-center justify-between pb-4">
            <p className="eyebrow">Recent change</p>
            <Link href="/timeline" className="link text-xs">
              Full timeline →
            </Link>
          </div>
          {timeline.events.length === 0 ? (
            <p className="text-sm text-muted">No recorded events yet.</p>
          ) : (
            <ul className="space-y-1">
              {timeline.events.map((e) => (
                <TimelineEventRow key={e.id} event={e} compact />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
