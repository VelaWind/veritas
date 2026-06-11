"use client";

import { ReactNode, useState } from "react";
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

  return (
    <div>
      <div role="tablist" className="flex gap-1 border-b border-edge">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={t.key === active}
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
      <div role="tabpanel" className="pt-4">
        {current?.content}
      </div>
    </div>
  );
}
