import type { NextRequest } from "next/server";
import {
  apiData,
  apiError,
  apiZodError,
  requireAdmin,
  translateDbError,
} from "@/lib/api";
import { revalidateEntity } from "@/lib/revalidation";
import { noteCreateSchema } from "@/lib/validations";

/** Not in the §6 table; required for admin notes CRUD (see DECISIONS.md). */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON body.", 400);
  }
  const parsed = noteCreateSchema.safeParse(body);
  if (!parsed.success) return apiZodError(parsed.error);

  const { data, error } = await auth.supabase
    .from("research_notes")
    .insert({ ...parsed.data, author_id: auth.user.id })
    .select()
    .single();

  if (error) return apiError(translateDbError(error.message), 409);

  revalidateEntity("note", data.slug);
  return apiData(data, { status: 201 });
}
