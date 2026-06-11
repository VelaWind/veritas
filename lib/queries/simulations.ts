import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Simulation,
  SimulationCategory,
  SimulationWithRuns,
} from "@/types/domain";

export async function listSimulations(
  client: SupabaseClient,
  opts: { category?: SimulationCategory } = {},
): Promise<Array<Simulation & { run_count: number }>> {
  try {
    let query = client.from("simulations").select("*, simulation_runs(count)");
    if (opts.category) query = query.eq("category", opts.category);
    const { data, error } = await query.order("created_at", { ascending: false });
    if (error) return [];
    type Raw = Simulation & { simulation_runs: Array<{ count: number }> };
    return ((data ?? []) as Raw[]).map(({ simulation_runs, ...s }) => ({
      ...s,
      run_count: simulation_runs?.[0]?.count ?? 0,
    }));
  } catch {
    return [];
  }
}

export async function listSimulationsWithRuns(
  client: SupabaseClient,
  category: SimulationCategory,
): Promise<SimulationWithRuns[]> {
  try {
    const { data, error } = await client
      .from("simulations")
      .select("*, runs:simulation_runs(*)")
      .eq("category", category)
      .order("created_at", { ascending: false });
    if (error) return [];
    const sims = (data ?? []) as unknown as SimulationWithRuns[];
    for (const sim of sims) {
      sim.runs = [...(sim.runs ?? [])].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
    }
    return sims;
  } catch {
    return [];
  }
}

export async function getSimulationById(
  client: SupabaseClient,
  id: string,
): Promise<SimulationWithRuns | null> {
  try {
    const { data, error } = await client
      .from("simulations")
      .select("*, runs:simulation_runs(*)")
      .eq("id", id)
      .maybeSingle();
    if (error || !data) return null;
    return data as unknown as SimulationWithRuns;
  } catch {
    return null;
  }
}
