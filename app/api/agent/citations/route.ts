import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiData, apiError, apiZodError, requireAgent } from "@/lib/api";
import { resolveCitation } from "@/lib/citations";

/**
 * §D.5a — the citation verifier's endpoint.
 *
 * The agent sends citation STRINGS; the server resolves them against Crossref
 * and OpenAlex and stores what it found. The agent never supplies the verdict.
 * That asymmetry is the point: if a runner could post `status: "verified"`, a
 * compromised agent could stamp every reference in the map as checked, and the
 * badge would carry no information.
 *
 * `unresolved` is a flag for a reviewer, never an auto-reject — real papers are
 * missing from both indexes, and preprints, books, and older work resolve badly.
 */

const bodySchema = z.object({
  citations: z
    .array(
      z.object({
        citation: z.string().trim().min(3).max(1000),
        claimed_title: z.string().trim().max(500).default(""),
      }),
    )
    .min(1)
    .max(20),
});

export async function POST(request: NextRequest) {
  const auth = await requireAgent(request);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON body.", 400);
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return apiZodError(parsed.error);

  const results = [];
  for (const { citation, claimed_title } of parsed.data.citations) {
    const result = await resolveCitation(citation, claimed_title);

    // Upsert on the citation key so two agents citing the same DOI resolve it
    // once, and a re-check refreshes rather than duplicating.
    const { error } = await auth.supabase.from("citation_checks").upsert(
      {
        citation_key: result.citation_key,
        doi: result.doi,
        url: result.url,
        claimed_title: result.claimed_title,
        status: result.status,
        resolved_title: result.resolved_title,
        resolved_year: result.resolved_year,
        matched_via: result.matched_via,
        score: result.score,
        source: result.source,
        raw: result.raw,
        checked_at: new Date().toISOString(),
      },
      { onConflict: "citation_key" },
    );
    if (error) return apiError(`Could not record citation check: ${error.message}`, 500);

    results.push({
      citation_key: result.citation_key,
      status: result.status,
      resolved_title: result.resolved_title,
      score: result.score,
    });
  }

  return apiData(results, { status: 200 });
}
