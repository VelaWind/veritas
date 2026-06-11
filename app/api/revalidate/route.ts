import type { NextRequest } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { apiData, apiError, apiZodError, requireAdmin } from "@/lib/api";
import { revalidateSchema } from "@/lib/validations";

/** §6: tag/path-based ISR revalidation after writes. */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON body.", 400);
  }
  const parsed = revalidateSchema.safeParse(body);
  if (!parsed.success) return apiZodError(parsed.error);

  for (const tag of parsed.data.tags) revalidateTag(tag);
  for (const path of parsed.data.paths) revalidatePath(path);

  return apiData({
    revalidated: true,
    tags: parsed.data.tags,
    paths: parsed.data.paths,
  });
}
