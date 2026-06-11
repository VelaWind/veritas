import type { NextRequest } from "next/server";
import {
  apiData,
  apiError,
  apiZodError,
  requireAdmin,
  translateDbError,
} from "@/lib/api";
import { revalidateEntity } from "@/lib/revalidation";
import { simulationRunCreateSchema } from "@/lib/validations";

type Ctx = { params: Promise<{ id: string }> };

/**
 * §6: record a run. V1.0 records and visualizes runs; execution is V2.
 * A run with finished_at set emits a simulation_completed timeline event
 * via trigger.
 */
export async function POST(request: NextRequest, ctx: Ctx) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON body.", 400);
  }
  const parsed = simulationRunCreateSchema.safeParse(body);
  if (!parsed.success) return apiZodError(parsed.error);

  const { data, error } = await auth.supabase
    .from("simulation_runs")
    .insert({
      ...parsed.data,
      simulation_id: id,
      artifact_path: parsed.data.artifact_path ?? null,
      started_at: parsed.data.started_at ?? null,
      finished_at: parsed.data.finished_at ?? null,
    })
    .select()
    .single();

  if (error) return apiError(translateDbError(error.message), 409);

  revalidateEntity("simulation");
  return apiData(data, { status: 201 });
}
