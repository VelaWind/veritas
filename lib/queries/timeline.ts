import type { SupabaseClient } from "@supabase/supabase-js";
import type { TimelineEvent, TimelineEventType } from "@/types/domain";
import { logQueryError, logQueryThrow } from "./log";

export interface TimelinePage {
  events: TimelineEvent[];
  nextCursor: number | null;
}

const EMPTY: TimelinePage = { events: [], nextCursor: null };

export async function listTimeline(
  client: SupabaseClient,
  opts: { cursor?: number; type?: TimelineEventType; limit?: number } = {},
): Promise<TimelinePage> {
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
  try {
    let query = client
      .from("timeline_events")
      .select("*")
      .order("id", { ascending: false })
      .limit(limit + 1);

    if (opts.cursor !== undefined) query = query.lt("id", opts.cursor);
    if (opts.type) query = query.eq("event_type", opts.type);

    const { data, error } = await query;
    if (error) return logQueryError("listTimeline", error, EMPTY);

    const rows = (data ?? []) as TimelineEvent[];
    const hasMore = rows.length > limit;
    const events = hasMore ? rows.slice(0, limit) : rows;
    return {
      events,
      nextCursor: hasMore ? events[events.length - 1].id : null,
    };
  } catch (err) {
    return logQueryThrow("listTimeline", err, EMPTY);
  }
}
