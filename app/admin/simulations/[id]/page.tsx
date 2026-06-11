import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSimulationById } from "@/lib/queries/simulations";
import { RunForm, SimulationForm } from "@/components/admin/SimulationForm";
import { formatDateTime } from "@/lib/utils";

export const metadata = { title: "Admin · Edit simulation" };

export default async function EditSimulationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const simulation = await getSimulationById(supabase, id);
  if (!simulation) notFound();

  return (
    <div className="space-y-8">
      <h1 className="font-display text-xl font-light text-ink">
        Edit simulation: {simulation.title}
      </h1>

      <div className="card p-6">
        <SimulationForm initial={simulation} />
      </div>

      <div className="card p-6">
        <RunForm simulationId={simulation.id} />
      </div>

      <div className="card p-6">
        <p className="eyebrow pb-3">Recorded runs ({simulation.runs.length})</p>
        {simulation.runs.length === 0 ? (
          <p className="text-sm text-muted">No runs recorded yet.</p>
        ) : (
          <ul className="divide-y divide-edge">
            {simulation.runs.map((r) => (
              <li key={r.id} className="py-3">
                <div className="flex flex-wrap items-center gap-3 font-mono text-xs text-muted">
                  <span>{r.id.slice(0, 8)}</span>
                  <span>
                    {r.started_at ? formatDateTime(r.started_at) : "not started"} →{" "}
                    {r.finished_at ? formatDateTime(r.finished_at) : "running"}
                  </span>
                  {r.artifact_path && <span>artifact: {r.artifact_path}</span>}
                </div>
                <pre className="mt-2 overflow-x-auto rounded border border-edge bg-void p-3 font-mono text-xs text-muted">
                  {JSON.stringify({ parameters: r.parameters, results: r.results }, null, 2)}
                </pre>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
