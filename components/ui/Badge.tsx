import { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Neutral UI chip for non-epistemic labels (states, categories, counts).
 * Epistemic statuses must use EpistemicBadge — never this.
 */
export function Badge({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border border-edge bg-raised px-2 py-0.5 font-mono text-xs text-muted",
        className,
      )}
      {...props}
    />
  );
}
