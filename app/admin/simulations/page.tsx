import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { listSimulations } from "@/lib/queries/simulations";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

export const metadata = { title: "Admin · Simulations" };

export default async function AdminSimulationsPage() {
  const supabase = await createClient();
  const simulations = await listSimulations(supabase);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-display text-xl font-light text-ink">Simulations</h1>
        <Link href="/admin/simulations/new">
          <Button variant="primary">New simulation</Button>
        </Link>
      </div>

      {simulations.length === 0 ? (
        <p className="card p-8 text-center text-sm text-muted">No simulations yet.</p>
      ) : (
        <ul className="card divide-y divide-edge">
          {simulations.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <Link
                href={`/admin/simulations/${s.id}`}
                className="min-w-0 flex-1 text-sm text-ink hover:text-accent"
              >
                {s.title}
              </Link>
              <span className="font-mono text-xs text-muted">
                {s.category.replace(/_/g, " ")}
              </span>
              <span className="font-mono text-xs text-muted">{s.run_count} runs</span>
              <Badge>{s.status}</Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
