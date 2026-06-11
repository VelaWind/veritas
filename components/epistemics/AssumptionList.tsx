import { Check, HelpCircle } from "lucide-react";
import type { Assumption } from "@/types/domain";

/** Renders a hypothesis's assumptions, flagging which are justified. */
export function AssumptionList({ assumptions }: { assumptions: Assumption[] }) {
  if (!assumptions || assumptions.length === 0) {
    return <p className="text-sm text-muted">No assumptions recorded.</p>;
  }
  return (
    <ul className="space-y-3">
      {assumptions.map((a, i) => (
        <li key={i} className="flex gap-3">
          <span className="mt-0.5 shrink-0" aria-hidden>
            {a.justified ? (
              <Check size={16} style={{ color: "var(--signal-strong)" }} />
            ) : (
              <HelpCircle size={16} style={{ color: "var(--signal-mid)" }} />
            )}
          </span>
          <div>
            <p className="text-sm text-ink">{a.text}</p>
            <p className="font-mono text-xs text-muted">
              {a.justified ? "justified" : "unjustified"}
              {a.notes ? ` — ${a.notes}` : ""}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
