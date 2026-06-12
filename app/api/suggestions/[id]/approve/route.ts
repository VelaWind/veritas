import type { NextRequest } from "next/server";
import { apiData, apiError, requireAdmin, translateDbError } from "@/lib/api";
import { revalidateEntity } from "@/lib/revalidation";
import { suggestionReviewSchema } from "@/lib/validations";

type Ctx = { params: Promise<{ id: string }> };

/**
 * §Phase A: approve = apply atomically via the security-definer
 * apply_suggestion() function, which inserts/updates the real node through all
 * existing epistemic constraints and audit triggers, then stamps the review.
 * The admin's JWT carries through (auth.uid() inside the function = this admin).
 */
export async function POST(request: NextRequest, ctx: Ctx) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    /* notes are optional on approve */
  }
  const parsed = suggestionReviewSchema.safeParse(body ?? {});
  const notes = parsed.success ? parsed.data.notes : "";

  const { data, error } = await auth.supabase.rpc("apply_suggestion", {
    p_suggestion_id: id,
    p_notes: notes,
  });
  if (error) return apiError(translateDbError(error.message), 409);

  const result = data as {
    applied_id: string;
    target_type: "hypothesis" | "evidence";
    operation: string;
  };

  // Precise detail-path revalidation: look up the applied node's slug.
  const table = result.target_type === "hypothesis" ? "hypotheses" : "evidence";
  const { data: node } = await auth.supabase
    .from(table)
    .select("slug")
    .eq("id", result.applied_id)
    .maybeSingle();

  revalidateEntity(result.target_type, node?.slug);
  return apiData(result);
}
