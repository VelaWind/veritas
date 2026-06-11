"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { TimelineEventRow } from "@/components/TimelineEventRow";
import { EVENT_META, EVENT_TYPES } from "@/lib/knowledge-engine/events";
import { api } from "@/lib/client-api";
import type { TimelineEvent, TimelineEventType } from "@/types/domain";

interface Page {
  events: TimelineEvent[];
  nextCursor: number | null;
}

/**
 * §3: cursor-paginated Timeline of Understanding. Seeded from the server with
 * the first page; "Load more" walks the id cursor via /api/timeline.
 */
export function TimelineFeed({ initial }: { initial: Page }) {
  const [events, setEvents] = useState<TimelineEvent[]>(initial.events);
  const [cursor, setCursor] = useState<number | null>(initial.nextCursor);
  const [type, setType] = useState<TimelineEventType | "">("");
  const [loading, setLoading] = useState(false);
  const reqId = useRef(0);

  const load = useCallback(
    async (reset: boolean, filterType: TimelineEventType | "") => {
      setLoading(true);
      const id = ++reqId.current;
      const params = new URLSearchParams();
      if (!reset && cursor) params.set("cursor", String(cursor));
      if (filterType) params.set("type", filterType);
      const res = await api.get<Page>(`/api/timeline?${params.toString()}`);
      if (id !== reqId.current) return; // a newer request superseded this one
      if (res.data) {
        setEvents((prev) => (reset ? res.data!.events : [...prev, ...res.data!.events]));
        setCursor(res.data.nextCursor);
      }
      setLoading(false);
    },
    [cursor],
  );

  // Reload from scratch whenever the type filter changes (skip first mount).
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    setEvents([]);
    setCursor(null);
    load(true, type);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setType("")}
          aria-pressed={type === ""}
          className={`rounded border px-2.5 py-1 font-mono text-xs ${
            type === "" ? "border-accent text-accent" : "border-edge text-muted hover:text-ink"
          }`}
        >
          ALL
        </button>
        {EVENT_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setType(t)}
            aria-pressed={type === t}
            className={`rounded border px-2.5 py-1 font-mono text-xs ${
              type === t ? "border-accent text-accent" : "border-edge text-muted hover:text-ink"
            }`}
          >
            {EVENT_META[t].label}
          </button>
        ))}
      </div>

      {events.length === 0 && !loading ? (
        <p className="card p-8 text-center text-sm text-muted">
          No events for this filter.
        </p>
      ) : (
        <ul className="card divide-y divide-edge px-5">
          {events.map((e) => (
            <TimelineEventRow key={e.id} event={e} />
          ))}
        </ul>
      )}

      <div className="flex justify-center">
        {cursor !== null ? (
          <Button onClick={() => load(false, type)} disabled={loading}>
            {loading ? "Loading…" : "Load more"}
          </Button>
        ) : (
          events.length > 0 && (
            <p className="font-mono text-xs text-muted">— the beginning of the record —</p>
          )
        )}
      </div>
    </div>
  );
}
