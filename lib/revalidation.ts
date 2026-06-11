import { revalidatePath, revalidateTag } from "next/cache";

/**
 * Tag + path revalidation after admin writes (§1.3, §4.1). Cached data
 * carries tags via unstable_cache (graph, stats); ISR pages are path-based.
 */

export type EntityKind =
  | "hypothesis"
  | "evidence"
  | "question"
  | "domain"
  | "simulation"
  | "note"
  | "contradiction";

const LIST_PATHS: Record<EntityKind, string[]> = {
  hypothesis: ["/", "/hypotheses", "/dashboard", "/graph"],
  evidence: ["/", "/evidence", "/dashboard", "/graph"],
  question: ["/", "/questions", "/dashboard", "/graph"],
  domain: ["/", "/domains", "/dashboard", "/graph"],
  simulation: ["/lab", "/dashboard", "/graph"],
  note: ["/", "/notes"],
  contradiction: ["/dashboard", "/hypotheses", "/graph"],
};

const DETAIL_PREFIX: Partial<Record<EntityKind, string>> = {
  hypothesis: "/hypotheses",
  evidence: "/evidence",
  question: "/questions",
  domain: "/domains",
  note: "/notes",
};

export function revalidateEntity(kind: EntityKind, slug?: string) {
  for (const path of LIST_PATHS[kind]) revalidatePath(path);
  const prefix = DETAIL_PREFIX[kind];
  if (prefix && slug) revalidatePath(`${prefix}/${slug}`);
  if (kind === "simulation") revalidatePath("/lab", "layout");
  // Everything is a node (§1.2-3): any entity write may reshape the graph.
  revalidateTag("graph");
  revalidateTag("stats");
  revalidatePath("/timeline");
  revalidatePath("/sitemap.xml");
}
