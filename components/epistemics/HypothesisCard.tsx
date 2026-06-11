import Link from "next/link";
import type { HypothesisListItem } from "@/types/domain";
import { EpistemicBadge } from "./EpistemicBadge";
import { ConfidenceMeter } from "./ConfidenceMeter";
import { STATE_LABELS } from "@/lib/knowledge-engine/taxonomy";
import { stripMarkdown, truncate } from "@/lib/utils";

/** Hypothesis summary card — always shows status badge + confidence meter. */
export function HypothesisCard({ hypothesis }: { hypothesis: HypothesisListItem }) {
  return (
    <Link
      href={`/hypotheses/${hypothesis.slug}`}
      className="card group flex flex-col gap-4 p-5 transition-colors hover:bg-raised"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-display text-base font-medium text-ink group-hover:text-accent">
          {hypothesis.title}
        </h3>
        <EpistemicBadge status={hypothesis.status} />
      </div>

      <p className="text-sm text-muted">
        {truncate(stripMarkdown(hypothesis.description), 150)}
      </p>

      <div className="mt-auto">
        {/* No animation on cards — the sweep is reserved for the detail page. */}
        <ConfidenceMeter
          value={hypothesis.confidence}
          rationale={hypothesis.confidence_rationale}
          size="sm"
          animate={false}
        />
        <div className="mt-2 flex items-center justify-between font-mono text-xs text-muted">
          {hypothesis.domain && <span>{hypothesis.domain.name}</span>}
          <span>{STATE_LABELS[hypothesis.state]}</span>
        </div>
      </div>
    </Link>
  );
}
