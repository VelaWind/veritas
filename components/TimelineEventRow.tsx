import Link from "next/link";
import { EVENT_META, eventHref } from "@/lib/knowledge-engine/events";
import type { TimelineEvent } from "@/types/domain";
import { formatDateTime, timeAgo } from "@/lib/utils";

export function TimelineEventRow({
  event,
  compact = false,
}: {
  event: TimelineEvent;
  compact?: boolean;
}) {
  const meta = EVENT_META[event.event_type];
  const href = eventHref(event);

  const inner = (
    <>
      <span
        aria-hidden
        className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: `var(${meta.cssVar})` }}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-ink">{event.summary}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 font-mono text-xs text-muted">
          <span style={{ color: `var(${meta.cssVar})` }}>{meta.label}</span>
          <span>·</span>
          <span title={formatDateTime(event.created_at)}>{timeAgo(event.created_at)}</span>
          {event.actor_type === "agent" && event.agent_name && (
            <>
              <span>·</span>
              <span>{event.agent_name}</span>
            </>
          )}
          {event.actor_type === "system" && (
            <>
              <span>·</span>
              <span>system</span>
            </>
          )}
        </p>
      </div>
    </>
  );

  const className = `flex gap-3 ${compact ? "py-2" : "py-3"}`;

  if (href) {
    return (
      <li>
        <Link href={href} className={`${className} -mx-2 rounded px-2 hover:bg-raised`}>
          {inner}
        </Link>
      </li>
    );
  }
  return <li className={className}>{inner}</li>;
}
