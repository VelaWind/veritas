import type { NextRequest } from "next/server";
import {
  apiData,
  apiError,
  apiZodError,
  requireAdmin,
  translateDbError,
} from "@/lib/api";
import { getSuggestedConfidence } from "@/lib/queries/hypotheses";
import { revalidateEntity } from "@/lib/revalidation";
import { confidenceUpdateSchema } from "@/lib/validations";

type Ctx = { params: Promise<{ id: string }> };

/**
 * §6: PATCH { value, rationale } — the trigger records confidence_history and
 * the timeline event, and rejects empty rationales (§10 invariant 2). The
 * epistemics_consistent constraint rejects values outside the status band.
 * Returns suggested_confidence alongside so admins see the divergence.
 */
export async function PATCH(request: NextRequest, ctx: Ctx) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON body.", 400);
  }
  const parsed = confidenceUpdateSchema.safeParse(body);
  if (!parsed.success) return apiZodError(parsed.error);

  const { data, error } = await auth.supabase
    .from("hypotheses")
    .update({
      confidence: parsed.data.value,
      confidence_rationale: parsed.data.rationale,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) return apiError(translateDbError(error.message), 409);

  const suggested = await getSuggestedConfidence(auth.supabase, id);
  revalidateEntity("hypothesis", data.slug);
  return apiData({ hypothesis: data, suggested_confidence: suggested });
}
