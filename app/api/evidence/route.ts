import type { NextRequest } from "next/server";
import {
  apiData,
  apiError,
  apiZodError,
  requireAdmin,
  translateDbError,
} from "@/lib/api";
import { publicClient } from "@/lib/supabase/public";
import { listEvidence } from "@/lib/queries/evidence";
import { revalidateEntity } from "@/lib/revalidation";
import { evidenceCreateSchema, sourceTypeSchema } from "@/lib/validations";

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const typeRaw = sp.get("sourceType");
  const type = typeRaw ? sourceTypeSchema.safeParse(typeRaw) : null;
  if (type && !type.success) return apiError("Invalid sourceType filter.", 422);

  const rows = await listEvidence(publicClient, {
    domainSlug: sp.get("domain") ?? undefined,
    sourceType: type?.data,
  });
  return apiData(rows);
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON body.", 400);
  }
  const parsed = evidenceCreateSchema.safeParse(body);
  if (!parsed.success) return apiZodError(parsed.error);

  const { new_source, ...evidenceFields } = parsed.data;
  let sourceId = evidenceFields.source_id ?? null;

  if (!sourceId && new_source) {
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
    sourceId = source.id;
  }

  const { data, error } = await auth.supabase
    .from("evidence")
    .insert({
      ...evidenceFields,
      source_id: sourceId,
      domain_id: evidenceFields.domain_id ?? null,
      created_by: auth.user.id,
      actor_type: "human",
    })
    .select()
    .single();

  if (error) return apiError(translateDbError(error.message), 409);

  revalidateEntity("evidence", data.slug);
  return apiData(data, { status: 201 });
}
