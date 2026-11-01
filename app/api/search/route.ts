import type { NextRequest } from "next/server";
import { apiData, apiError, apiZodError } from "@/lib/api";
import { publicClient } from "@/lib/supabase/public";
import { createAdminClient } from "@/lib/supabase/admin";
import { HAS_LIVE_SUPABASE, SUPABASE_SERVICE_ROLE_KEY } from "@/lib/supabase/env";
import { globalSearch } from "@/lib/queries/search";
import { searchQuerySchema } from "@/lib/validations";
import { bucketFor, createRateLimiter } from "@/lib/rate-limit";

/**
 * Rate limit (§9 Phase 5): 30 searches per client per minute, counted in
 * Postgres so the limit holds across serverless instances (migration 0016,
 * lib/rate-limit.ts). Falls back to a per-instance count when the shared store
 * cannot answer; that fallback is logged, never silent.
 */
const POLICY = { windowMs: 60_000, max: 30 };

// One warning per instance per minute: until 0016 is applied, every search
// would otherwise log the same line.
let lastWarn = 0;
function warnFallback(reason: string) {
  const now = Date.now();
  if (now - lastWarn < 60_000) return;
  lastWarn = now;
  console.warn(`[rate-limit] shared store unavailable, using the per-instance count: ${reason}`);
}

const limiter = createRateLimiter({
  policy: POLICY,
  store: async (bucket, policy) => {
    // No database, or no service-role key (CI tier 2 builds with the public
    // values only): nothing to ask, so skip the network call.
    if (!HAS_LIVE_SUPABASE || SUPABASE_SERVICE_ROLE_KEY.includes("placeholder")) return null;
    const { data, error } = await createAdminClient().rpc("rate_limit_hit", {
      p_bucket: bucket,
      p_window_seconds: Math.round(policy.windowMs / 1000),
      p_max: policy.max,
    });
    if (error || typeof data !== "boolean") {
      warnFallback(`${error?.code ?? ""} ${error?.message ?? `unexpected ${typeof data}`}`.trim());
      return null;
    }
    return data;
  },
  onFallback: warnFallback,
});

async function sha256Hex(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function GET(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const { limited } = await limiter(await bucketFor("search", ip, sha256Hex));
  if (limited) {
    return apiError("Too many searches. Please slow down.", 429);
  }

  const parsed = searchQuerySchema.safeParse({
    q: request.nextUrl.searchParams.get("q") ?? "",
    limit: request.nextUrl.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) return apiZodError(parsed.error);

  const results = await globalSearch(publicClient, parsed.data.q, parsed.data.limit);
  return apiData(results);
}
