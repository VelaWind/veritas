import type { Metadata } from "next";
import { publicClient } from "@/lib/supabase/public";
import { getGraphPayload } from "@/lib/queries/graph";
import { PageHeader } from "@/components/layout/PageHeader";
import { ResearchGraph } from "@/components/graph/ResearchGraph";

export const revalidate = 3600; // §1.3: graph fed by cached payload (1h)

export const metadata: Metadata = {
  title: "Research Graph",
  description:
    "The knowledge map as a force-directed graph: questions, hypotheses, evidence, and domains, linked by support, contradiction, and derivation.",
};

export default async function GraphPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const focus = typeof sp.focus === "string" ? sp.focus : undefined;
  const payload = await getGraphPayload(publicClient);

  return (
    <div className="mx-auto max-w-content space-y-8 px-4 py-12 sm:px-6">
      <PageHeader
        eyebrow="Everything is a node"
        title="Research Graph"
        description="One consistent structure the search engine, the timeline, and future agents all traverse. Node color encodes epistemic status; edge style encodes the relationship."
      />
      <ResearchGraph payload={payload} focusSlug={focus} />
    </div>
  );
}
