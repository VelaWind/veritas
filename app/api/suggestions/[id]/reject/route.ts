import type { NextRequest } from "next/server";
import {
  apiData,
  apiError,
  apiZodError,
  requireAdmin,
  translateDbError,
} from "@/lib/api";
import { suggestionRejectSchema } from "@/lib/validations";

type Ctx = { params: Promise<{ id: string }> };

/** §Phase A: reject a pending suggestion with a short reason for the proposer. */
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
  const parsed = suggestionRejectSchema.safeParse(body);
  if (!parsed.success) return apiZodError(parsed.error);

  const { data, error } = await auth.supabase
    .from("suggestions")
    .update({
      status: "rejected",
      reviewed_by: auth.user.id,
      reviewed_at: new Date().toISOString(),
      review_notes: parsed.data.notes,
    })
    .eq("id", id)
    .eq("status", "pending")
    .select()
    .maybeSingle();

  if (error) return apiError(translateDbError(error.message), 409);
  if (!data) return apiError("Suggestion not found or already decided.", 404);
  return apiData(data);
}
