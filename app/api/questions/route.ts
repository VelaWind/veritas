import type { NextRequest } from "next/server";
import {
  apiData,
  apiError,
  apiZodError,
  requireAdmin,
  translateDbError,
} from "@/lib/api";
import { publicClient } from "@/lib/supabase/public";
import { listQuestions } from "@/lib/queries/questions";
import { revalidateEntity } from "@/lib/revalidation";
import { epistemicStatusSchema, questionCreateSchema } from "@/lib/validations";

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const statusRaw = sp.get("status");
  const status = statusRaw ? epistemicStatusSchema.safeParse(statusRaw) : null;
  if (status && !status.success) return apiError("Invalid status filter.", 422);

  const rows = await listQuestions(publicClient, {
    domainSlug: sp.get("domain") ?? undefined,
    status: status?.data,
    sort: sp.get("sort") === "updated" ? "updated" : "importance",
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
  const parsed = questionCreateSchema.safeParse(body);
  if (!parsed.success) return apiZodError(parsed.error);

  const { data, error } = await auth.supabase
    .from("questions")
    .insert({ ...parsed.data, created_by: auth.user.id })
    .select()
    .single();

  if (error) return apiError(translateDbError(error.message), 409);

  revalidateEntity("question", data.slug);
  return apiData(data, { status: 201 });
}
