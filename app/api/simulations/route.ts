import type { NextRequest } from "next/server";
import {
  apiData,
  apiError,
  apiZodError,
  requireAdmin,
  translateDbError,
} from "@/lib/api";
import { publicClient } from "@/lib/supabase/public";
import { listSimulations } from "@/lib/queries/simulations";
import { revalidateEntity } from "@/lib/revalidation";
import { simulationCategorySchema, simulationCreateSchema } from "@/lib/validations";

export async function GET(request: NextRequest) {
  const categoryRaw = request.nextUrl.searchParams.get("category");
  const category = categoryRaw ? simulationCategorySchema.safeParse(categoryRaw) : null;
  if (category && !category.success) return apiError("Invalid category.", 422);

  const rows = await listSimulations(publicClient, { category: category?.data });
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
  const parsed = simulationCreateSchema.safeParse(body);
  if (!parsed.success) return apiZodError(parsed.error);

  const { data, error } = await auth.supabase
    .from("simulations")
    .insert({ ...parsed.data, created_by: auth.user.id })
    .select()
    .single();

  if (error) return apiError(translateDbError(error.message), 409);

  revalidateEntity("simulation");
  return apiData(data, { status: 201 });
}
