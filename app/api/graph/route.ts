import type { NextRequest } from "next/server";
import { unstable_cache } from "next/cache";
import { apiData } from "@/lib/api";
import { publicClient } from "@/lib/supabase/public";
import { getGraphPayload } from "@/lib/queries/graph";

/** §7: nodes + edges JSON for the Research Graph, cached 1h, tag 'graph'. */
export async function GET(request: NextRequest) {
  const domain = request.nextUrl.searchParams.get("domain") ?? undefined;

  const getCached = unstable_cache(
    () => getGraphPayload(publicClient, { domainSlug: domain }),
    ["graph", domain ?? "all"],
    { revalidate: 3600, tags: ["graph"] },
  );

  const payload = await getCached();
  return apiData(payload);
}
