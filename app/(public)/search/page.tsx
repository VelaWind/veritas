import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { publicClient } from "@/lib/supabase/public";
import { globalSearch } from "@/lib/queries/search";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { SearchBox } from "@/components/SearchBox";
import { sanitizeHeadline } from "@/lib/utils";
import type { NodeType } from "@/types/domain";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Search",
  description: "Full-text search across hypotheses, questions, and evidence.",
};

const PATH: Partial<Record<NodeType, string>> = {
  hypothesis: "/hypotheses",
  question: "/questions",
  evidence: "/evidence",
};

const TYPE_LABEL: Record<NodeType, string> = {
  hypothesis: "Hypothesis",
  question: "Question",
  evidence: "Evidence",
  domain: "Domain",
  simulation: "Simulation",
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const results = q.trim().length >= 2 ? await globalSearch(publicClient, q.trim(), 40) : [];

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-12 sm:px-6">
      <PageHeader
        eyebrow="Find anything"
        title="Search"
        description="Full-text search across the knowledge map. Press ⌘K anywhere for the command palette."
      />

      <Suspense>
        <SearchBox initialQuery={q} />
      </Suspense>

      {q.trim().length < 2 ? (
        <p className="text-sm text-muted">Enter a search term above.</p>
      ) : results.length === 0 ? (
        <EmptyState
          title={`No results for “${q.trim()}”`}
          description="Try different or broader terms."
        />
      ) : (
        <>
          <p className="font-mono text-xs text-muted">
            {results.length} result{results.length === 1 ? "" : "s"}
          </p>
          <ul className="card divide-y divide-edge">
            {results.map((r) => {
              const base = PATH[r.node_type];
              const inner = (
                <>
                  <span className="font-mono text-xs uppercase text-muted">
                    {TYPE_LABEL[r.node_type]}
                  </span>
                  <span className="mt-1 block font-display text-base text-ink">
                    {r.title}
                  </span>
                  {r.snippet && (
                    <span
                      className="snippet mt-1 block text-sm text-muted"
                      dangerouslySetInnerHTML={{ __html: sanitizeHeadline(r.snippet) }}
                    />
                  )}
                </>
              );
              return (
                <li key={`${r.node_type}-${r.id}`} className="px-5 py-4">
                  {base ? (
                    <Link href={`${base}/${r.slug}`} className="block hover:opacity-90">
                      {inner}
                    </Link>
                  ) : (
                    inner
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
