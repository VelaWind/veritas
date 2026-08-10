import type { NextRequest } from "next/server";
import { unstable_cache } from "next/cache";
import { apiData, EmptyPayloadError } from "@/lib/api";
import { publicClient } from "@/lib/supabase/public";
import { HAS_LIVE_SUPABASE } from "@/lib/supabase/env";
import { getGraphPayload } from "@/lib/queries/graph";

/** §7: nodes + edges JSON for the Research Graph, cached 1h, tag 'graph'. */
export async function GET(request: NextRequest) {
  const domain = request.nextUrl.searchParams.get("domain") ?? undefined;
  const read = () => getGraphPayload(publicClient, { domainSlug: domain });

  // ── AUDIT.md F-09, M1 ─────────────────────────────────────────────────────
  // With no credentials the query layer returns its empty FALLBACK instead of
  // throwing, and unstable_cache keys record nothing about credentials — so
  // that fallback would be stored under exactly the key a healthy run uses, and
  // served later by a credentialed server as a fresh hit. Bypass the cache
  // entirely rather than poison it.
  if (!HAS_LIVE_SUPABASE) return apiData(await read());

  const getCached = unstable_cache(
    async () => {
      const payload = await read();
      // ── M2, defence in depth ────────────────────────────────────────────
      // Past this point credentials are live, so the query layer throws on
      // failure and an empty result means the database genuinely returned no
      // rows. That is still not something worth caching for an hour, and if M1
      // is ever bypassed this is what stops the poison being written.
      if (payload.nodes.length === 0) throw new EmptyPayloadError("graph");
      return payload;
    },
    ["graph", domain ?? "all"],
    { revalidate: 3600, tags: ["graph"] },
  );

  try {
    return apiData(await getCached());
  } catch (err) {
    // Serve the empty result, just do not cache it — a fresh pre-seed database
    // must render empty, not error. Anything else (e.g. QueryFailedError from
    // the live-credentials path) propagates and stays loud.
    if (err instanceof EmptyPayloadError) return apiData(await read());
    throw err;
  }
}
