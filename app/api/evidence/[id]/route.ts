import type { NextRequest } from "next/server";
import {
  apiData,
  apiError,
  apiZodError,
  requireAdmin,
  translateDbError,
} from "@/lib/api";
import { publicClient } from "@/lib/supabase/public";
import { revalidateEntity } from "@/lib/revalidation";
import { evidenceUpdateSchema } from "@/lib/validations";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const { data, error } = await publicClient
    .from("evidence")
    .select("*, source:sources(*), domain:domains(id, slug, name)")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return apiError("Evidence not found.", 404);
  return apiData(data);
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
  const parsed = evidenceUpdateSchema.safeParse(body);
  if (!parsed.success) return apiZodError(parsed.error);

  const { new_source, ...fields } = parsed.data;
  let update: Record<string, unknown> = { ...fields };

  if (new_source) {
    const { data: source, error: sourceError } = await auth.supabase
      .from("sources")
      .insert({
        ...new_source,
        authors: new_source.authors ?? null,
        url: new_source.url ?? null,
        doi: new_source.doi ?? null,
        year: new_source.year ?? null,
      })
      .select()
      .single();
    if (sourceError) return apiError(translateDbError(sourceError.message), 409);
    update = { ...update, source_id: source.id };
  }

  const { data, error } = await auth.supabase
    .from("evidence")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error) return apiError(translateDbError(error.message), 409);

  revalidateEntity("evidence", data.slug);
  return apiData(data);
}
