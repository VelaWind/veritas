import type { NextRequest } from "next/server";
import {
  apiData,
  apiError,
  apiZodError,
  requireAdmin,
  translateDbError,
} from "@/lib/api";
import { revalidateEntity } from "@/lib/revalidation";
import { contradictionResolveSchema } from "@/lib/validations";

type Ctx = { params: Promise<{ id: string }> };

/** §6: resolve (or reopen) a contradiction. Resolution requires notes. */
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
  const parsed = contradictionResolveSchema.safeParse(body);
  if (!parsed.success) return apiZodError(parsed.error);

  const { data, error } = await auth.supabase
    .from("contradictions")
    .update(parsed.data)
    .eq("id", id)
    .select()
    .single();

  if (error) return apiError(translateDbError(error.message), 409);

  revalidateEntity("contradiction");
  return apiData(data);
}
