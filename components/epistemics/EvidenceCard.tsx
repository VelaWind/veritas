import Link from "next/link";
import type { EvidenceListItem } from "@/types/domain";
import { SOURCE_TYPE_LABELS } from "@/lib/knowledge-engine/sources";
import { stripMarkdown, truncate } from "@/lib/utils";

/** Evidence summary card for the library and domain pages. */
export function EvidenceCard({ evidence }: { evidence: EvidenceListItem }) {
  return (
    <Link
      href={`/evidence/${evidence.slug}`}
      className="card group flex flex-col gap-3 p-5 transition-colors hover:bg-raised"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-display text-base font-medium text-ink group-hover:text-accent">
          {evidence.title}
        </h3>
        <span className="shrink-0 font-mono text-xs text-muted">s{evidence.strength}</span>
      </div>
      <p className="text-sm text-muted">{truncate(stripMarkdown(evidence.summary), 160)}</p>
      <div className="mt-auto flex flex-wrap items-center gap-2 font-mono text-xs text-muted">
        {evidence.source && (
          <span>{SOURCE_TYPE_LABELS[evidence.source.source_type]}</span>
        )}
        {evidence.source?.year && <span>· {evidence.source.year}</span>}
        {evidence.domain && (
          <span className="ml-auto rounded border border-edge px-2 py-0.5">
            {evidence.domain.name}
          </span>
        )}
      </div>
    </Link>
  );
}
