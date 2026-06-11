import Link from "next/link";
import { Scale } from "lucide-react";
import type { EvidenceLinkFull } from "@/types/domain";
import { SOURCE_TYPE_LABELS } from "@/lib/knowledge-engine/sources";

/**
 * §5.4 — EvidenceBalance: the two-column for/against ledger with per-item
 * weight bars. The visual centerpiece of every hypothesis page. Rows stagger
 * in (§5.6) via CSS animation, suppressed under prefers-reduced-motion.
 */
function LedgerColumn({
  title,
  links,
  tone,
  startIndex,
}: {
  title: string;
  links: EvidenceLinkFull[];
  tone: "support" | "oppose";
  startIndex: number;
}) {
  const color = tone === "support" ? "var(--signal-strong)" : "var(--contradiction)";
  return (
    <div className="flex-1">
      <div className="mb-3 flex items-center justify-between">
        <p className="eyebrow" style={{ color }}>
          {title}
        </p>
        <span className="font-mono text-xs text-muted">{links.length}</span>
      </div>
      {links.length === 0 ? (
        <p className="text-sm text-muted">None recorded.</p>
      ) : (
        <ul className="space-y-2.5">
          {links.map((l, i) => (
            <li
              key={l.evidence.id}
              className="ledger-row rounded border border-edge bg-void p-3"
              style={{ animationDelay: `${(startIndex + i) * 40}ms` }}
            >
              <Link
                href={`/evidence/${l.evidence.slug}`}
                className="text-sm text-ink hover:text-accent"
              >
                {l.evidence.title}
              </Link>
              <div className="mt-2 flex items-center gap-2">
                <div
                  className="h-1.5 flex-1 overflow-hidden rounded-full"
                  style={{ backgroundColor: "var(--bg-raised)" }}
                  aria-hidden
                >
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${l.weight}%`, backgroundColor: color }}
                  />
                </div>
                <span className="font-mono text-xs text-muted">w{l.weight}</span>
              </div>
              {l.evidence.source && (
                <p className="mt-1.5 font-mono text-xs text-muted">
                  {l.evidence.source.authors ? `${l.evidence.source.authors} · ` : ""}
                  {l.evidence.source.year ?? ""} ·{" "}
                  {SOURCE_TYPE_LABELS[l.evidence.source.source_type]}
                </p>
              )}
              {l.notes && <p className="mt-1.5 text-xs text-muted">{l.notes}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function EvidenceBalance({ links }: { links: EvidenceLinkFull[] }) {
  const supports = links.filter((l) => l.relation === "supports");
  const opposes = links.filter((l) => l.relation === "opposes");
  const neutral = links.filter((l) => l.relation === "neutral");

  const supportWeight = supports.reduce((s, l) => s + l.weight, 0);
  const opposeWeight = opposes.reduce((s, l) => s + l.weight, 0);
  const total = supportWeight + opposeWeight;
  const supportPct = total === 0 ? 50 : Math.round((supportWeight / total) * 100);

  return (
    <section aria-label="Evidence balance" className="space-y-5">
      <div className="flex items-center gap-2">
        <Scale size={16} className="text-muted" aria-hidden />
        <h2 className="font-display text-lg font-medium text-ink">Evidence balance</h2>
      </div>

      {total > 0 && (
        <div>
          <div
            className="flex h-2 overflow-hidden rounded-full"
            role="img"
            aria-label={`Weighted balance: ${supportPct}% supporting, ${100 - supportPct}% opposing`}
          >
            <div style={{ width: `${supportPct}%`, backgroundColor: "var(--signal-strong)" }} />
            <div style={{ width: `${100 - supportPct}%`, backgroundColor: "var(--contradiction)" }} />
          </div>
          <div className="mt-1.5 flex justify-between font-mono text-xs text-muted">
            <span>support {supportPct}%</span>
            <span>oppose {100 - supportPct}%</span>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-6 sm:flex-row">
        <LedgerColumn title="Supporting" links={supports} tone="support" startIndex={0} />
        <div className="hidden w-px self-stretch bg-edge sm:block" aria-hidden />
        <LedgerColumn
          title="Opposing"
          links={opposes}
          tone="oppose"
          startIndex={supports.length}
        />
      </div>

      {neutral.length > 0 && (
        <div className="border-t border-edge pt-4">
          <p className="eyebrow mb-2">Contextual ({neutral.length})</p>
          <ul className="flex flex-wrap gap-2">
            {neutral.map((l) => (
              <li key={l.evidence.id}>
                <Link
                  href={`/evidence/${l.evidence.slug}`}
                  className="rounded border border-edge bg-void px-2.5 py-1 text-xs text-muted hover:text-ink"
                >
                  {l.evidence.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
