import type { NextRequest } from "next/server";
import { apiData, apiError, requireContributor, translateDbError } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

/**
 * §Phase A: a proposer withdraws their OWN still-pending suggestion. RLS
 * ("proposer update own pending") allows pending → withdrawn and nothing else,
 * so this cannot be used to self-approve.
 */
export async function POST(_request: NextRequest, ctx: Ctx) {
  const auth = await requireContributor();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;

  const { data, error } = await auth.supabase
    .from("suggestions")
    .update({ status: "withdrawn" })
    .eq("id", id)
    .eq("proposed_by", auth.user.id)
    .eq("status", "pending")
    .select()
    .maybeSingle();

  if (error) return apiError(translateDbError(error.message), 409);
  if (!data) return apiError("Suggestion not found, not yours, or already decided.", 404);
  return apiData(data);
}
