import type { Metadata } from "next";
import Link from "next/link";
import { publicClient } from "@/lib/supabase/public";
import { listPublicAgents } from "@/lib/queries/agents";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { AgentStatusBadge } from "@/components/agents/AgentStatusBadge";
import { KIND_META, KIND_ORDER } from "@/lib/knowledge-engine/agents";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Agents",
  description:
    "The research agents that propose into Veritas — their charters, their record, and their oversight.",
};

export default async function AgentsPage() {
  const agents = await listPublicAgents(publicClient);
  const byKind = KIND_ORDER.map((kind) => ({
    kind,
    meta: KIND_META[kind],
    members: agents.filter((a) => a.kind === kind),
  })).filter((g) => g.members.length > 0);

  return (
    <div className="mx-auto max-w-content space-y-10 px-4 py-12 sm:px-6">
      <PageHeader
        eyebrow="Who proposes what"
        title="Agents"
        description={
          <>
            Agents are contributors, not authors. Each one proposes into a review
            queue that a human reads; none of them can write to the map. Their
            record here is the part that is public: what was accepted, what was
            declined, and what the last audit found.
          </>
        }
      />

      {agents.length === 0 ? (
        <EmptyState
          title="No agents yet"
          description="Once the roster is seeded, every agent appears here with its charter and record."
        />
      ) : (
        <div className="space-y-10">
          {byKind.map((group) => (
            <section key={group.kind} className="space-y-4">
              <div className="space-y-1">
                <h2 className="font-display text-lg font-light text-ink">
                  {group.meta.label}
                </h2>
                <p className="text-sm text-muted">{group.meta.blurb}</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {group.members.map((a) => (
                  <Link
                    key={a.name}
                    href={`/agents/${a.name}`}
                    className="card group flex flex-col gap-3 p-6 transition-colors hover:bg-raised"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="font-display text-base font-medium text-ink group-hover:text-accent">
                        {a.display_name}
                      </h3>
                      <AgentStatusBadge status={a.status} />
                    </div>
                    {a.domain_name && (
                      <p className="font-mono text-xs text-muted">{a.domain_name}</p>
                    )}
                    <p className="line-clamp-3 text-sm text-muted">
                      {a.charter.split("\n")[0]}
                    </p>
                    <div className="mt-auto flex flex-wrap gap-4 pt-2 font-mono text-xs text-muted">
                      {a.stats && a.stats.approval_rate !== null ? (
                        <span>{a.stats.approval_rate}% approved</span>
                      ) : (
                        <span>no decided proposals</span>
                      )}
                      {a.stats && <span>{a.stats.approved} in the map</span>}
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
