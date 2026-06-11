import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { listEvidence } from "@/lib/queries/evidence";
import { Button } from "@/components/ui/Button";

export const metadata = { title: "Admin · Evidence" };

export default async function AdminEvidencePage() {
  const supabase = await createClient();
  const evidence = await listEvidence(supabase, { limit: 500 });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-display text-xl font-light text-ink">Evidence</h1>
        <Link href="/admin/evidence/new">
          <Button variant="primary">New evidence</Button>
        </Link>
      </div>

      {evidence.length === 0 ? (
        <p className="card p-8 text-center text-sm text-muted">No evidence yet.</p>
      ) : (
        <ul className="card divide-y divide-edge">
          {evidence.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <Link
                href={`/admin/evidence/${e.id}`}
                className="min-w-0 flex-1 text-sm text-ink hover:text-accent"
              >
                {e.title}
              </Link>
              <span className="font-mono text-xs text-muted">
                {e.source?.year ?? "—"}
              </span>
              <span className="font-mono text-xs text-ink">s{e.strength}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
