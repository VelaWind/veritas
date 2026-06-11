import type { Metadata } from "next";
import Link from "next/link";
import { publicClient } from "@/lib/supabase/public";
import { listSimulations } from "@/lib/queries/simulations";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { CATEGORY_META } from "@/lib/knowledge-engine/simulations";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Simulation Lab",
  description:
    "Five families of simulation — ecosystems, agents, civilizations, universes, and consciousness. V1.0 records and visualizes runs.",
};

export default async function LabPage() {
  const simulations = await listSimulations(publicClient);
  const byCategory = new Map<string, number>();
  for (const s of simulations) {
    byCategory.set(s.category, (byCategory.get(s.category) ?? 0) + 1);
  }

  return (
    <div className="mx-auto max-w-content space-y-10 px-4 py-12 sm:px-6">
      <PageHeader
        eyebrow="Computational frontier"
        title="Simulation Lab"
        description="Where Veritas models the systems it studies. V1.0 catalogs simulations and visualizes recorded runs; executing them in-platform is V2."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        {CATEGORY_META.map((c) => (
          <Link
            key={c.slug}
            href={`/lab/${c.slug}`}
            className="card group flex flex-col gap-3 p-6 transition-colors hover:bg-raised"
          >
            <div className="flex items-start justify-between gap-3">
              <h2 className="font-display text-lg font-medium text-ink group-hover:text-accent">
                {c.title}
              </h2>
              <Badge>{byCategory.get(c.category) ?? 0}</Badge>
            </div>
            <p className="text-sm text-muted">{c.blurb}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
