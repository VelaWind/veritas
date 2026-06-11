import type { NextRequest } from "next/server";
import {
  apiData,
  apiError,
  apiZodError,
  requireAdmin,
  translateDbError,
} from "@/lib/api";
import { publicClient } from "@/lib/supabase/public";
import { listHypotheses } from "@/lib/queries/hypotheses";
import { revalidateEntity } from "@/lib/revalidation";
import { epistemicStatusSchema, hypothesisCreateSchema } from "@/lib/validations";

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const statusRaw = sp.get("status");
  const status = statusRaw ? epistemicStatusSchema.safeParse(statusRaw) : null;
  if (status && !status.success) return apiError("Invalid status filter.", 422);

  const sortRaw = sp.get("sort");
  const sort = (["confidence", "updated", "created", "popularity"] as const).find(
    (s) => s === sortRaw,
  );

  const rows = await listHypotheses(publicClient, {
    domainSlug: sp.get("domain") ?? undefined,
    status: status?.data,
    minConfidence: sp.get("minConfidence") ? Number(sp.get("minConfidence")) : undefined,
    sort,
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
  const parsed = hypothesisCreateSchema.safeParse(body);
  if (!parsed.success) return apiZodError(parsed.error);

  const { data, error } = await auth.supabase
    .from("hypotheses")
    .insert({
      ...parsed.data,
      question_id: parsed.data.question_id ?? null,
      created_by: auth.user.id,
      actor_type: "human",
    })
    .select()
    .single();

  if (error) return apiError(translateDbError(error.message), 409);

  revalidateEntity("hypothesis", data.slug);
  return apiData(data, { status: 201 });
}
