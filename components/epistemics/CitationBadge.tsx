import type { CitationCheck } from "@/types/domain";

/**
 * §D.5a — what an automated lookup found when it went looking for this
 * reference, in Crossref and OpenAlex.
 *
 * The copy is deliberate. `unresolved` is NOT "bad citation": real papers are
 * missing from both indexes, and preprints, books, and older work resolve
 * poorly. Saying "not found in the indexes we check" says exactly what is known
 * and nothing more — the same discipline the map applies to its own claims.
 */
const META: Record<
  CitationCheck["status"],
  { label: string; cssVar: string; explain: string }
> = {
  verified: {
    label: "citation resolved",
    cssVar: "--signal-strong",
    explain: "This reference was found and its title matches what was cited.",
  },
  unresolved: {
    label: "citation not found",
    cssVar: "--signal-unknown",
    explain:
      "Not found in Crossref or OpenAlex. That is not evidence the work does not exist — books, preprints, and older material are often absent from both.",
  },
  mismatch: {
    label: "citation mismatch",
    cssVar: "--contradiction",
    explain:
      "The identifier resolves, but to a work whose title differs from the one cited. Worth checking by hand.",
  },
};

export function CitationBadge({ check }: { check: CitationCheck | null }) {
  if (!check) return null;
  const meta = META[check.status];

  return (
    <div className="space-y-1.5">
      <p className="flex items-center gap-1.5 font-mono text-xs">
        <span
          aria-hidden
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: `var(${meta.cssVar})` }}
        />
        <span style={{ color: `var(${meta.cssVar})` }}>{meta.label}</span>
      </p>
      <p className="text-xs text-muted">{meta.explain}</p>
      {check.resolved_title && check.status !== "verified" && (
        <p className="text-xs text-muted">
          Resolved to: <span className="text-ink">{check.resolved_title}</span>
          {check.resolved_year ? ` (${check.resolved_year})` : ""}
        </p>
      )}
    </div>
  );
}
