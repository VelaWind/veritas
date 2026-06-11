"use client";

import { useEffect, useRef, useState } from "react";
import { Info } from "lucide-react";
import {
  CONFIDENCE_BANDS,
  bandForConfidence,
} from "@/lib/knowledge-engine/taxonomy";
import type { ConfidenceHistoryEntry } from "@/types/domain";
import { cn, formatDate } from "@/lib/utils";

const BAND_VARS = [
  "--signal-unknown",
  "--signal-weak",
  "--signal-mid",
  "--signal-strong",
  "--signal-strong",
] as const;

function HistorySparkline({ history }: { history: ConfidenceHistoryEntry[] }) {
  const values = history.map((h) => h.new_value);
  if (history[0]?.old_value !== null && history[0]?.old_value !== undefined) {
    values.unshift(history[0].old_value);
  }
  if (values.length < 2) return null;

  const w = 240;
  const h = 48;
  const pad = 4;
  const min = 0;
  const max = 100;
  const step = (w - pad * 2) / (values.length - 1);
  const points = values
    .map((v, i) => {
      const x = pad + i * step;
      const y = h - pad - ((v - min) / (max - min)) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={`Confidence history: ${values.join(", ")}`}
      className="mt-2 w-full"
    >
      <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="var(--border)" />
      <polyline
        points={points}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * §5.5 — the signature instrument. A 0–100 track with the five named bands
 * ghosted underneath, a precise tick at the current value, the value in Plex
 * Mono, an info affordance revealing the rationale + history sparkline, and a
 * ghost tick showing suggested-vs-assigned divergence on hover.
 * Used identically EVERYWHERE a confidence score appears.
 */
export function ConfidenceMeter({
  value,
  suggested,
  rationale,
  history,
  label = "Confidence",
  size = "md",
  animate = true,
  className,
}: {
  value: number;
  suggested?: number | null;
  rationale?: string;
  history?: ConfidenceHistoryEntry[];
  label?: string;
  size?: "sm" | "md";
  animate?: boolean;
  className?: string;
}) {
  const [swept, setSwept] = useState(!animate);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!animate) return;
    // §5.6 — the one orchestrated moment: sweep 0 → value on first view.
    const raf = requestAnimationFrame(() => setSwept(true));
    return () => cancelAnimationFrame(raf);
  }, [animate]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const band = bandForConfidence(value);
  const diverges = suggested !== null && suggested !== undefined && suggested !== value;
  const hasInfo = Boolean(rationale || (history && history.length > 0) || diverges);
  const trackH = size === "md" ? "h-2.5" : "h-1.5";

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      <div className="group flex items-center gap-3">
        <div
          role="meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={value}
          aria-label={`${label}: ${value} of 100 (${band.label})`}
          className={cn("relative flex-1 overflow-hidden rounded-sm", trackH)}
        >
          {/* The five named bands, ghosted underneath (§5.5). */}
          {CONFIDENCE_BANDS.map((b, i) => (
            <div
              key={b.label}
              aria-hidden
              className="absolute inset-y-0"
              style={{
                left: `${b.from}%`,
                width: `${b.to - b.from + (i === 0 ? 0 : 1)}%`,
                backgroundColor: `color-mix(in srgb, var(${BAND_VARS[i]}) 16%, var(--bg-raised))`,
              }}
            />
          ))}
          {/* Ghost tick: model-suggested confidence (visible on hover). */}
          {diverges && (
            <div
              aria-hidden
              className="absolute inset-y-0 w-0.5 opacity-30 transition-opacity group-hover:opacity-80"
              style={{
                left: `calc(${suggested}% - 1px)`,
                backgroundColor: "var(--text-muted)",
                backgroundImage:
                  "repeating-linear-gradient(to bottom, transparent 0 2px, var(--bg-void) 2px 4px)",
              }}
            />
          )}
          {/* The precise tick at the assigned value. */}
          <div
            aria-hidden
            className="absolute inset-y-0 w-0.5"
            style={{
              left: swept ? `calc(${value}% - 1px)` : "0%",
              backgroundColor: "var(--text-primary)",
              transition: "left 600ms cubic-bezier(0, 0, 0.2, 1)",
            }}
          />
        </div>

        <span className="w-10 text-right font-mono text-sm tabular-nums text-ink">
          {value}
        </span>

        {hasInfo && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={`${label} details: rationale and history`}
            className="rounded p-1 text-muted hover:bg-raised hover:text-ink"
          >
            <Info size={14} aria-hidden />
          </button>
        )}
      </div>

      <div className="mt-1 flex items-center justify-between font-mono text-xs text-muted">
        <span>{band.label.toUpperCase()}</span>
        {diverges && (
          <span
            className="opacity-0 transition-opacity group-hover:opacity-100"
            aria-hidden
          >
            model suggests {suggested}
          </span>
        )}
      </div>

      {open && (
        <div className="card absolute right-0 top-full z-20 mt-2 w-80 max-w-[90vw] p-4">
          <p className="eyebrow">Why this number</p>
          <p className="mt-1.5 text-sm text-ink">
            {rationale?.trim() ? rationale : "No rationale recorded yet."}
          </p>
          {diverges && (
            <p className="mt-2 font-mono text-xs text-muted">
              assigned {value} · evidence model {suggested} · Δ{" "}
              {(suggested as number) - value > 0 ? "+" : ""}
              {(suggested as number) - value}
            </p>
          )}
          {history && history.length > 0 && (
            <div className="mt-3 border-t border-edge pt-3">
              <p className="eyebrow">History</p>
              <HistorySparkline history={history} />
              <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto">
                {[...history].reverse().map((h) => (
                  <li key={h.id} className="font-mono text-xs text-muted">
                    {formatDate(h.created_at)} · {h.old_value ?? "—"} → {h.new_value}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
