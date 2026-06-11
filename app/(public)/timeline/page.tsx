import type { Metadata } from "next";
import { publicClient } from "@/lib/supabase/public";
import { listTimeline } from "@/lib/queries/timeline";
import { PageHeader } from "@/components/layout/PageHeader";
import { TimelineFeed } from "@/components/TimelineFeed";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Timeline of Understanding",
  description:
    "Every change to the knowledge map, in order. The timeline is a byproduct of the write path — append-only and automatic.",
};

export default async function TimelinePage() {
  const initial = await listTimeline(publicClient, { limit: 30 });

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-12 sm:px-6">
      <PageHeader
        eyebrow="Append-only history"
        title="Timeline of Understanding"
        description="Hypotheses created, confidence revised, evidence linked, contradictions found and resolved — recorded automatically as the map changes."
      />
      <TimelineFeed initial={initial} />
    </div>
  );
}
