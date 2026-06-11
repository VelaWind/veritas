"use client";

import { ReactNode, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export function Tabs({
  tabs,
  initial,
}: {
  tabs: Array<{ key: string; label: string; content: ReactNode }>;
  initial?: string;
}) {
  const [active, setActive] = useState(initial ?? tabs[0]?.key);
  const current = tabs.find((t) => t.key === active) ?? tabs[0];
  const baseId = useId();
  const listRef = useRef<HTMLDivElement>(null);

  // WAI-ARIA tabs pattern: roving tabindex — arrows move and activate,
  // Home/End jump, Tab leaves the tablist entirely.
  function onKeyDown(e: React.KeyboardEvent) {
    const idx = tabs.findIndex((t) => t.key === active);
    let next = -1;
    if (e.key === "ArrowRight") next = (idx + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next === -1) return;
    e.preventDefault();
    setActive(tabs[next].key);
    listRef.current
      ?.querySelectorAll<HTMLButtonElement>("[role=tab]")
      [next]?.focus();
  }

  return (
    <div>
      <div
        ref={listRef}
        role="tablist"
        onKeyDown={onKeyDown}
        className="flex gap-1 border-b border-edge"
      >
        {tabs.map((t) => (
          <button
            key={t.key}
            id={`${baseId}-tab-${t.key}`}
            role="tab"
            type="button"
            aria-selected={t.key === active}
            aria-controls={`${baseId}-panel`}
            tabIndex={t.key === active ? 0 : -1}
            onClick={() => setActive(t.key)}
            className={cn(
              "-mb-px rounded-t px-3 py-1.5 font-mono text-xs uppercase tracking-wider",
              t.key === active
                ? "border border-edge border-b-void bg-void text-ink"
                : "text-muted hover:text-ink",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div
        id={`${baseId}-panel`}
        role="tabpanel"
        aria-labelledby={`${baseId}-tab-${current?.key}`}
        className="pt-4"
      >
        {current?.content}
      </div>
    </div>
  );
}
