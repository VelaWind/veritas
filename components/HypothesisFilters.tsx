"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { EPISTEMIC_STATUSES, STATUS_META } from "@/lib/knowledge-engine/taxonomy";

const SORTS = [
  { value: "confidence", label: "Confidence" },
  { value: "updated", label: "Recently updated" },
  { value: "created", label: "Newest" },
  { value: "popularity", label: "Most viewed" },
];

const MIN_CONFIDENCE = [
  { value: "0", label: "Any confidence" },
  { value: "21", label: "≥ 21 (plausible+)" },
  { value: "41", label: "≥ 41" },
  { value: "61", label: "≥ 61 (strong+)" },
  { value: "81", label: "≥ 81 (established)" },
];

export function HypothesisFilters({
  domains,
}: {
  domains: Array<{ slug: string; name: string }>;
}) {
  const router = useRouter();
  const sp = useSearchParams();

  function update(key: string, value: string) {
    const next = new URLSearchParams(sp.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`/hypotheses?${next.toString()}`, { scroll: false });
  }

  const selectClass =
    "rounded border border-edge bg-surface px-3 py-1.5 text-sm text-ink";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="f-domain">Domain</label>
      <select
        id="f-domain"
        value={sp.get("domain") ?? ""}
        onChange={(e) => update("domain", e.target.value)}
        className={selectClass}
      >
        <option value="">All domains</option>
        {domains.map((d) => (
          <option key={d.slug} value={d.slug}>
            {d.name}
          </option>
        ))}
      </select>

      <label className="sr-only" htmlFor="f-status">Status</label>
      <select
        id="f-status"
        value={sp.get("status") ?? ""}
        onChange={(e) => update("status", e.target.value)}
        className={selectClass}
      >
        <option value="">All statuses</option>
        {EPISTEMIC_STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_META[s].label}
          </option>
        ))}
      </select>

      <label className="sr-only" htmlFor="f-conf">Minimum confidence</label>
      <select
        id="f-conf"
        value={sp.get("minConfidence") ?? "0"}
        onChange={(e) => update("minConfidence", e.target.value === "0" ? "" : e.target.value)}
        className={selectClass}
      >
        {MIN_CONFIDENCE.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>

      <label className="sr-only" htmlFor="f-sort">Sort</label>
      <select
        id="f-sort"
        value={sp.get("sort") ?? "confidence"}
        onChange={(e) => update("sort", e.target.value)}
        className={selectClass}
      >
        {SORTS.map((s) => (
          <option key={s.value} value={s.value}>
            Sort: {s.label}
          </option>
        ))}
      </select>
    </div>
  );
}
