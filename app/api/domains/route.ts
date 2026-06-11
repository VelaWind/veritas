import type { NextRequest } from "next/server";
import {
  apiData,
  apiError,
  apiZodError,
  requireAdmin,
  translateDbError,
} from "@/lib/api";
import { publicClient } from "@/lib/supabase/public";
import { listDomains } from "@/lib/queries/domains";
import { revalidateEntity } from "@/lib/revalidation";
import { domainCreateSchema } from "@/lib/validations";

/** Not in the §6 table; required for admin domain CRUD (see DECISIONS.md). */
export async function GET() {
  const rows = await listDomains(publicClient);
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
  const parsed = domainCreateSchema.safeParse(body);
  if (!parsed.success) return apiZodError(parsed.error);

  const { data, error } = await auth.supabase
    .from("domains")
    .insert({ ...parsed.data, icon: parsed.data.icon ?? null })
    .select()
    .single();

  if (error) return apiError(translateDbError(error.message), 409);

  revalidateEntity("domain", data.slug);
  return apiData(data, { status: 201 });
}
