import type { NextRequest } from "next/server";
import { apiData, apiError, apiZodError } from "@/lib/api";
import { publicClient } from "@/lib/supabase/public";
import { globalSearch } from "@/lib/queries/search";
import { searchQuerySchema } from "@/lib/validations";

/**
 * Minimal in-memory rate limit (§9 Phase 5). Serverless instances each get
 * their own bucket — acceptable as a soft control; harden with an edge
 * middleware/KV layer if search abuse ever materializes.
 */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;
const hits = new Map<string, { count: number; windowStart: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    hits.set(ip, { count: 1, windowStart: now });
    return false;
  }
  entry.count += 1;
  if (hits.size > 10_000) hits.clear(); // unbounded-growth guard
  return entry.count > MAX_PER_WINDOW;
}

export async function GET(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (rateLimited(ip)) {
    return apiError("Too many searches — please slow down.", 429);
  }

  const parsed = searchQuerySchema.safeParse({
    q: request.nextUrl.searchParams.get("q") ?? "",
    limit: request.nextUrl.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) return apiZodError(parsed.error);

  const results = await globalSearch(publicClient, parsed.data.q, parsed.data.limit);
  return apiData(results);
}
