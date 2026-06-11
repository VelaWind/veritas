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
import { evidenceLinkSchema, evidenceUnlinkSchema } from "@/lib/validations";

type Ctx = { params: Promise<{ id: string }> };

/** Link evidence. The DB trigger emits the graph edge + timeline event. */
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
  const parsed = evidenceLinkSchema.safeParse(body);
  if (!parsed.success) return apiZodError(parsed.error);

  const { data, error } = await auth.supabase
    .from("hypothesis_evidence")
    .insert({
      hypothesis_id: id,
      evidence_id: parsed.data.evidenceId,
      relation: parsed.data.relation,
      weight: parsed.data.weight,
      notes: parsed.data.notes,
      created_by: auth.user.id,
    })
    .select()
    .single();

  if (error) return apiError(translateDbError(error.message), 409);

  const suggested = await getSuggestedConfidence(auth.supabase, id);
  revalidateEntity("hypothesis");
  revalidateEntity("evidence");
  return apiData({ link: data, suggested_confidence: suggested }, { status: 201 });
}

/** Unlink evidence. The DB trigger removes the edge + logs the event. */
export async function DELETE(request: NextRequest, ctx: Ctx) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON body.", 400);
  }
  const parsed = evidenceUnlinkSchema.safeParse(body);
  if (!parsed.success) return apiZodError(parsed.error);

  const { error } = await auth.supabase
    .from("hypothesis_evidence")
    .delete()
    .eq("hypothesis_id", id)
    .eq("evidence_id", parsed.data.evidenceId);

  if (error) return apiError(translateDbError(error.message), 409);

  const suggested = await getSuggestedConfidence(auth.supabase, id);
  revalidateEntity("hypothesis");
  revalidateEntity("evidence");
  return apiData({ unlinked: true, suggested_confidence: suggested });
}
