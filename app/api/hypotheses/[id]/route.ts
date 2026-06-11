import type { NextRequest } from "next/server";
import {
  apiData,
  apiError,
  apiZodError,
  requireAdmin,
  translateDbError,
} from "@/lib/api";
import { publicClient } from "@/lib/supabase/public";
import { getHypothesisById } from "@/lib/queries/hypotheses";
import { revalidateEntity } from "@/lib/revalidation";
import { hypothesisUpdateSchema } from "@/lib/validations";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const row = await getHypothesisById(publicClient, id);
  if (!row) return apiError("Hypothesis not found.", 404);
  return apiData(row);
}

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
  const parsed = hypothesisUpdateSchema.safeParse(body);
  if (!parsed.success) return apiZodError(parsed.error);

  const { data, error } = await auth.supabase
    .from("hypotheses")
    .update(parsed.data)
    .eq("id", id)
    .select()
    .single();

  if (error) return apiError(translateDbError(error.message), 409);

  revalidateEntity("hypothesis", data.slug);
  return apiData(data);
}

/** §6: retire is soft — state='retired'; history stays intact. */
export async function DELETE(_request: NextRequest, ctx: Ctx) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  const { data, error } = await auth.supabase
    .from("hypotheses")
    .update({ state: "retired" })
    .eq("id", id)
    .select()
    .single();

  if (error) return apiError(translateDbError(error.message), 409);

  revalidateEntity("hypothesis", data.slug);
  return apiData(data);
}
