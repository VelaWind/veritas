import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { publicClient } from "@/lib/supabase/public";
import {
  agentActivity,
  getPublicAgent,
  listPublicAgentNames,
} from "@/lib/queries/agents";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { AgentStatusBadge } from "@/components/agents/AgentStatusBadge";
import { TimelineEventRow } from "@/components/TimelineEventRow";
import { KIND_META, STATUS_META } from "@/lib/knowledge-engine/agents";

export const revalidate = 3600;

export async function generateStaticParams() {
  const names = await listPublicAgentNames(publicClient);
  return names.map((name) => ({ name }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ name: string }>;
}): Promise<Metadata> {
  const { name } = await params;
  const agent = await getPublicAgent(publicClient, name);
  if (!agent) return { title: "Agent not found" };
  return {
    title: agent.display_name,
    description: agent.charter.split("\n")[0],
  };
}

export default async function AgentProfilePage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  const agent = await getPublicAgent(publicClient, name);
  if (!agent) notFound();

  const activity = await agentActivity(publicClient, agent.name);
  const stats = agent.stats;
  const statusMeta = STATUS_META[agent.status];

  return (
    <div className="mx-auto max-w-content space-y-10 px-4 py-12 sm:px-6">
      <PageHeader
        eyebrow={KIND_META[agent.kind].label}
        title={agent.display_name}
        description={
          agent.domain_name ? (
            <>
              Field of expertise:{" "}
              <Link
                href={`/domains/${agent.domain_slug}`}
                className="text-ink underline decoration-edge underline-offset-4 hover:decoration-accent"
              >
                {agent.domain_name}
              </Link>
            </>
          ) : (
            KIND_META[agent.kind].blurb
          )
        }
        actions={<AgentStatusBadge status={agent.status} />}
      />

      <div className="grid gap-8 lg:grid-cols-[1fr_18rem]">
        <div className="min-w-0 space-y-8">
          <section className="space-y-3">
            <h2 className="eyebrow">Charter</h2>
            <div className="space-y-3 text-muted">
              {agent.charter.split("\n\n").map((para, i) => (
                <p key={i}>{para}</p>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="eyebrow">Recent activity</h2>
            <p className="text-sm text-muted">
              What this agent has had <em>accepted</em> into the map. Proposals
              still awaiting review are not shown — unreviewed work is not a
              claim Veritas makes.
            </p>
            {activity.length === 0 ? (
              <EmptyState
                title="Nothing accepted yet"
                description="When a reviewer approves something this agent proposed, it appears here and on the public timeline."
              />
            ) : (
              <div className="divide-y divide-edge border-y border-edge">
                {activity.map((event) => (
                  <TimelineEventRow key={event.id} event={event} />
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-6">
          <div className="card space-y-4 p-6 lg:sticky lg:top-20">
            <div>
              <p className="eyebrow">Record</p>
              <p className="mt-1 text-xs text-muted">{statusMeta.description}</p>
            </div>

            {stats ? (
              <div className="space-y-2 border-t border-edge pt-4 font-mono text-xs text-muted">
                <div className="flex justify-between">
                  <span>Approval rate</span>
                  <span className="text-ink">
                    {stats.approval_rate === null ? "—" : `${stats.approval_rate}%`}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>In the map</span>
                  <span>{stats.approved}</span>
                </div>
                <div className="flex justify-between">
                  <span>Declined</span>
                  <span>{stats.rejected}</span>
                </div>
                <div className="flex justify-between">
                  <span>Awaiting review</span>
                  <span>{stats.pending}</span>
                </div>
              </div>
            ) : (
              <p className="border-t border-edge pt-4 text-xs text-muted">
                No proposals recorded yet.
              </p>
            )}

            <p className="border-t border-edge pt-4 text-xs text-muted">
              An approval rate is a measure of this agent&rsquo;s calibration, not
              of whether its field is settled. A low rate in a contested domain
              can be honest work.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
