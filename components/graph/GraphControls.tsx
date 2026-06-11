"use client";

import { NODE_TYPE_LABEL } from "@/lib/knowledge-engine/graph-style";
import type { NodeType } from "@/types/domain";

const TYPES: NodeType[] = ["hypothesis", "question", "evidence", "domain", "simulation"];

export function GraphControls({
  domains,
  typeFilter,
  onToggleType,
  domainFilter,
  onDomainFilter,
}: {
  domains: Array<{ slug: string; label: string }>;
  typeFilter: Set<NodeType>;
  onToggleType: (t: NodeType) => void;
  domainFilter: string;
  onDomainFilter: (slug: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1.5">
        {TYPES.map((t) => {
          const on = typeFilter.has(t);
          return (
            <button
              key={t}
              type="button"
              aria-pressed={on}
              onClick={() => onToggleType(t)}
              className={`rounded border px-2.5 py-1 font-mono text-xs ${
                on ? "border-accent text-accent" : "border-edge text-muted hover:text-ink"
              }`}
            >
              {NODE_TYPE_LABEL[t]}
            </button>
          );
        })}
      </div>

      <select
        aria-label="Filter by domain"
        value={domainFilter}
        onChange={(e) => onDomainFilter(e.target.value)}
        className="ml-auto rounded border border-edge bg-surface px-3 py-1.5 text-sm text-ink"
      >
        <option value="">All domains</option>
        {domains.map((d) => (
          <option key={d.slug} value={d.slug}>
            {d.label}
          </option>
        ))}
      </select>
    </div>
  );
}
