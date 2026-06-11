import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listDomains } from "@/lib/queries/domains";
import {
  getHypothesisById,
  getSuggestedConfidence,
} from "@/lib/queries/hypotheses";
import { contradictionsForHypothesis } from "@/lib/queries/contradictions";
import { HypothesisForm } from "@/components/admin/HypothesisForm";
import { ConfidenceEditor } from "@/components/admin/ConfidenceEditor";
import { EvidenceLinker } from "@/components/admin/EvidenceLinker";
import { RetireHypothesisButton } from "@/components/admin/ActionButtons";
import { EpistemicBadge } from "@/components/epistemics/EpistemicBadge";

export const metadata = { title: "Admin · Edit hypothesis" };

export default async function EditHypothesisPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [hypothesis, domains, questionsRes, evidenceRes] = await Promise.all([
    getHypothesisById(supabase, id),
    listDomains(supabase),
    supabase.from("questions").select("id, title, domain_id"),
    supabase.from("evidence").select("id, slug, title, strength").order("title"),
  ]);
  if (!hypothesis) notFound();

  const [suggested, contradictions] = await Promise.all([
    getSuggestedConfidence(supabase, hypothesis.id),
    contradictionsForHypothesis(supabase, hypothesis.id),
  ]);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="eyebrow">Edit hypothesis</p>
          <h1 className="mt-1 font-display text-xl font-light text-ink">
            {hypothesis.title}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <EpistemicBadge status={hypothesis.status} />
          <Link href={`/hypotheses/${hypothesis.slug}`} className="link text-sm">
            View public page
          </Link>
        </div>
      </div>

      {contradictions.filter((c) => !c.resolved).length > 0 && (
        <div
          className="card border-l-2 p-4"
          style={{ borderLeftColor: "var(--contradiction)" }}
        >
          <p className="font-mono text-xs" style={{ color: "var(--contradiction)" }}>
            {contradictions.filter((c) => !c.resolved).length} OPEN CONTRADICTION(S)
          </p>
          <p className="mt-1 text-sm text-muted">
            Review them in the{" "}
            <Link href="/admin/contradictions" className="link">
              contradiction queue
            </Link>
            .
          </p>
        </div>
      )}

      <ConfidenceEditor
        hypothesisId={hypothesis.id}
        current={hypothesis.confidence}
        status={hypothesis.status}
        suggested={suggested}
        history={hypothesis.history}
        rationale={hypothesis.confidence_rationale}
      />

      <EvidenceLinker
        hypothesisId={hypothesis.id}
        links={hypothesis.links}
        allEvidence={(evidenceRes.data ?? []) as Array<{
          id: string;
          slug: string;
          title: string;
          strength: number;
        }>}
      />

      <div className="card p-6">
        <p className="eyebrow pb-4">Details</p>
        <HypothesisForm
          domains={domains}
          questions={(questionsRes.data ?? []) as Array<{
            id: string;
            title: string;
            domain_id: string;
          }>}
          initial={hypothesis}
        />
      </div>

      <div className="card flex items-center justify-between gap-4 p-6">
        <div>
          <p className="eyebrow">Danger zone</p>
          <p className="mt-1 text-xs text-muted">
            Retiring is soft — the record and its history remain (append-only).
          </p>
        </div>
        <RetireHypothesisButton id={hypothesis.id} />
      </div>
    </div>
  );
}
