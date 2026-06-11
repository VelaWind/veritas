import { STATUS_META } from "@/lib/knowledge-engine/taxonomy";
import type { EpistemicStatus } from "@/types/domain";
import { cn } from "@/lib/utils";

/**
 * §5.4 — the five-level taxonomy as a small mono-type chip. Always visible on
 * any card representing a claim. Never omitted, never restyled per page.
 * Signal hue comes exclusively from the taxonomy (unknown = grey, never red).
 */
export function EpistemicBadge({
  status,
  className,
}: {
  status: EpistemicStatus;
  className?: string;
}) {
  const meta = STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-xs uppercase tracking-wider",
        className,
      )}
      style={{
        color: `var(${meta.cssVar})`,
        borderColor: `color-mix(in srgb, var(${meta.cssVar}) 35%, transparent)`,
        backgroundColor: `color-mix(in srgb, var(${meta.cssVar}) 8%, transparent)`,
      }}
      title={`${meta.label}: ${meta.description} Confidence band ${meta.min}–${meta.max}.`}
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: `var(${meta.cssVar})` }}
      />
      {meta.chip}
    </span>
  );
}
