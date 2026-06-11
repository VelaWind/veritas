import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { listHypotheses } from "@/lib/queries/hypotheses";
import { EpistemicBadge } from "@/components/epistemics/EpistemicBadge";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { STATE_LABELS } from "@/lib/knowledge-engine/taxonomy";

export const metadata = { title: "Admin · Hypotheses" };

export default async function AdminHypothesesPage() {
  const supabase = await createClient();
  const hypotheses = await listHypotheses(supabase, {
    includeDrafts: true,
    sort: "updated",
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-display text-xl font-light text-ink">Hypotheses</h1>
        <Link href="/admin/hypotheses/new">
          <Button variant="primary">New hypothesis</Button>
        </Link>
      </div>

      {hypotheses.length === 0 ? (
        <p className="card p-8 text-center text-sm text-muted">No hypotheses yet.</p>
      ) : (
        <ul className="card divide-y divide-edge">
          {hypotheses.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <Link
                href={`/admin/hypotheses/${h.id}`}
                className="min-w-0 flex-1 text-sm text-ink hover:text-accent"
              >
                {h.title}
              </Link>
              <span className="font-mono text-xs text-muted">{h.domain?.name}</span>
              <span className="font-mono text-xs text-ink">{h.confidence}</span>
              <Badge>{STATE_LABELS[h.state]}</Badge>
              <EpistemicBadge status={h.status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
