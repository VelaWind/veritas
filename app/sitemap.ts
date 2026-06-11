import type { MetadataRoute } from "next";
import { publicClient } from "@/lib/supabase/public";
import { listDomainSlugs } from "@/lib/queries/domains";
import { listHypothesisSlugs } from "@/lib/queries/hypotheses";
import { listEvidenceSlugs } from "@/lib/queries/evidence";
import { listQuestionSlugs } from "@/lib/queries/questions";
import { listNoteSlugs } from "@/lib/queries/notes";
import { CATEGORY_META } from "@/lib/knowledge-engine/simulations";
import { SITE_URL } from "@/lib/utils";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes = [
    "",
    "/dashboard",
    "/domains",
    "/hypotheses",
    "/evidence",
    "/questions",
    "/timeline",
    "/graph",
    "/lab",
    "/search",
    "/notes",
  ];

  const [domains, hypotheses, evidence, questions, notes] = await Promise.all([
    listDomainSlugs(publicClient),
    listHypothesisSlugs(publicClient),
    listEvidenceSlugs(publicClient),
    listQuestionSlugs(publicClient),
    listNoteSlugs(publicClient),
  ]);

  const now = new Date();

  const entries: MetadataRoute.Sitemap = [
    ...staticRoutes.map((path) => ({
      url: `${SITE_URL}${path}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: path === "" ? 1 : 0.7,
    })),
    ...CATEGORY_META.map((c) => ({
      url: `${SITE_URL}/lab/${c.slug}`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.5,
    })),
    ...domains.map((slug) => ({ url: `${SITE_URL}/domains/${slug}`, lastModified: now, priority: 0.6 })),
    ...hypotheses.map((slug) => ({ url: `${SITE_URL}/hypotheses/${slug}`, lastModified: now, priority: 0.8 })),
    ...evidence.map((slug) => ({ url: `${SITE_URL}/evidence/${slug}`, lastModified: now, priority: 0.5 })),
    ...questions.map((slug) => ({ url: `${SITE_URL}/questions/${slug}`, lastModified: now, priority: 0.7 })),
    ...notes.map((slug) => ({ url: `${SITE_URL}/notes/${slug}`, lastModified: now, priority: 0.4 })),
  ];

  return entries;
}
