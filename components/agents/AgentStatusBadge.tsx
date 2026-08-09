import type { AgentStatus } from "@/types/domain";
import { STATUS_META } from "@/lib/knowledge-engine/agents";

export function AgentStatusBadge({
  status,
  showDescription = false,
}: {
  status: AgentStatus;
  showDescription?: boolean;
}) {
  const meta = STATUS_META[status];
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <span
        aria-hidden
        className="h-2 w-2 rounded-full"
        style={{ backgroundColor: `var(${meta.cssVar})` }}
      />
      <span
        className="font-mono text-xs"
        style={{ color: `var(${meta.cssVar})` }}
        title={showDescription ? undefined : meta.description}
      >
        {meta.label}
      </span>
    </span>
  );
}
