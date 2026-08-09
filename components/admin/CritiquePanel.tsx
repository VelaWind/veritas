import type { CritiqueVerdict, SuggestionCritiqueRow } from "@/types/domain";

/**
 * §D.2 — the skeptic's objection, rendered beside the proposal it attacks.
 *
 * The point of the lane is that a reviewer reads claim and strongest objection
 * together. So this is not hidden behind a disclosure the way "Proposed fields"
 * is: an objection you have to click to see is an objection you will skip.
 *
 * `sound` is styled as a finding in its own right, not as an absence of one — a
 * claim that survived a real attack is information, and rendering it as silence
 * would waste it.
 */
const VERDICT_META: Record<CritiqueVerdict, { label: string; cssVar: string }> = {
  weak_assumption: { label: "weak assumption", cssVar: "--contradiction" },
  evidence_thin: { label: "evidence thin", cssVar: "--contradiction" },
  confidence_overstated: { label: "confidence overstated", cssVar: "--signal-mid" },
  scope_creep: { label: "scope creep", cssVar: "--signal-mid" },
  sound: { label: "survived attack", cssVar: "--signal-strong" },
};

export function CritiquePanel({ critiques }: { critiques?: SuggestionCritiqueRow[] }) {
  if (!critiques || critiques.length === 0) return null;

  return (
    <div className="mt-3 space-y-3">
      {critiques.map((c) => {
        const meta = VERDICT_META[c.verdict] ?? VERDICT_META.evidence_thin;
        return (
          <div
            key={`${c.critic_name}-${c.created_at}`}
            className="rounded border border-edge bg-void p-3"
          >
            <p className="flex flex-wrap items-center gap-x-2 font-mono text-xs">
              <span className="text-muted">{c.critic_name}</span>
              <span className="text-muted">·</span>
              <span style={{ color: `var(${meta.cssVar})` }}>{meta.label}</span>
            </p>
            <p className="mt-2 text-sm text-ink">{c.body}</p>
            {c.findings.length > 0 && (
              <ul className="mt-2 space-y-1">
                {c.findings.map((f, i) => (
                  <li key={i} className="flex gap-2 text-xs text-muted">
                    <span aria-hidden>·</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
