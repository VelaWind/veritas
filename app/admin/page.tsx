import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { listTimeline } from "@/lib/queries/timeline";
import {
  RefreshStatsButton,
  ScanContradictionsButton,
} from "@/components/admin/ActionButtons";
import { formatDateTime } from "@/lib/utils";

export const metadata = { title: "Admin" };

async function tableCount(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: string,
  eq?: [column: string, value: string],
): Promise<number> {
  try {
    let query = supabase.from(table).select("*", { count: "exact", head: true });
    if (eq) query = query.eq(eq[0], eq[1]);
    const { count } = await query;
    return count ?? 0;
  } catch {
    return 0;
  }
}

export default async function AdminOverviewPage() {
  const supabase = await createClient();

  const [
    domains,
    questions,
    hypotheses,
    drafts,
    evidence,
    contradictions,
    simulations,
    notes,
    timeline,
  ] = await Promise.all([
    tableCount(supabase, "domains"),
    tableCount(supabase, "questions"),
    tableCount(supabase, "hypotheses"),
    tableCount(supabase, "hypotheses", ["state", "draft"]),
    tableCount(supabase, "evidence"),
    tableCount(supabase, "contradictions", ["resolved", "false"]),
    tableCount(supabase, "simulations"),
    tableCount(supabase, "research_notes"),
    listTimeline(supabase, { limit: 10 }),
  ]);

  const stats = [
    { label: "Domains", value: domains, href: "/admin/domains" },
    { label: "Questions", value: questions, href: "/admin/questions" },
    { label: "Hypotheses", value: hypotheses, href: "/admin/hypotheses" },
    { label: "Drafts", value: drafts, href: "/admin/hypotheses" },
    { label: "Evidence", value: evidence, href: "/admin/evidence" },
    { label: "Open contradictions", value: contradictions, href: "/admin/contradictions" },
    { label: "Simulations", value: simulations, href: "/admin/simulations" },
    { label: "Notes", value: notes, href: "/admin/notes" },
  ];

  return (
    <div className="space-y-8">
      <div>
        <p className="eyebrow">Admin</p>
        <h1 className="mt-1 font-display text-xl font-light text-ink">
          Instrument control
        </h1>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className="card p-4 transition-colors hover:bg-raised">
            <p className="font-mono text-xl text-ink">{s.value}</p>
            <p className="mt-1 text-xs text-muted">{s.label}</p>
          </Link>
        ))}
      </div>

      <div className="card space-y-4 p-6">
        <p className="eyebrow">Maintenance</p>
        <div className="flex flex-wrap gap-4">
          <ScanContradictionsButton />
          <RefreshStatsButton />
        </div>
        <p className="text-xs text-muted">
          The scan inserts evidential contradictions (idempotent); stats feed
          the public Reality Dashboard via the materialized view.
        </p>
      </div>

      <div className="card p-6">
        <p className="eyebrow">Recent activity (audit trail)</p>
        {timeline.events.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No events yet — the trail populates automatically with every write.</p>
        ) : (
          <ul className="mt-3 divide-y divide-edge">
            {timeline.events.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 py-2">
                <span className="font-mono text-xs text-muted">
                  {formatDateTime(e.created_at)}
                </span>
                <span className="font-mono text-xs text-accent">{e.event_type}</span>
                <span className="min-w-0 flex-1 text-sm text-ink">{e.summary}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
