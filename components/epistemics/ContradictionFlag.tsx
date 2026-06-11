import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import type { ContradictionWithPartners } from "@/types/domain";
import { CONTRADICTION_KIND_META } from "@/lib/knowledge-engine/contradiction";

/**
 * §5.4 — ContradictionFlag: --contradiction left border + icon, linking to the
 * record. The contradiction hue is reserved exclusively for this.
 */
export function ContradictionFlag({
  contradictions,
  selfId,
}: {
  contradictions: ContradictionWithPartners[];
  selfId: string;
}) {
  const open = contradictions.filter((c) => !c.resolved);
  if (open.length === 0) return null;

  return (
    <div
      className="card space-y-3 border-l-2 p-4"
      style={{ borderLeftColor: "var(--contradiction)" }}
    >
      <div className="flex items-center gap-2">
        <AlertTriangle
          size={16}
          aria-hidden
          style={{ color: "var(--contradiction)" }}
        />
        <p
          className="font-mono text-xs uppercase tracking-wider"
          style={{ color: "var(--contradiction)" }}
        >
          {open.length} open contradiction{open.length > 1 ? "s" : ""}
        </p>
      </div>
      <ul className="space-y-2">
        {open.map((c) => {
          const other = c.hypothesis_a === selfId ? c.b : c.a;
          return (
            <li key={c.id} className="text-sm text-muted">
              <span className="text-ink">{CONTRADICTION_KIND_META[c.kind].label}:</span>{" "}
              {c.explanation}{" "}
              {other && (
                <>
                  Conflicts with{" "}
                  <Link href={`/hypotheses/${other.slug}`} className="link">
                    {other.title}
                  </Link>
                  .
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
