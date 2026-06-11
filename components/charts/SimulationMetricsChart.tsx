"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { parseMetrics } from "@/lib/knowledge-engine/simulations";

const LINE_COLORS = [
  "var(--accent)",
  "var(--signal-strong)",
  "var(--signal-mid)",
  "var(--signal-weak)",
];

export function SimulationMetricsChart({
  metrics,
}: {
  metrics: Record<string, unknown>;
}) {
  const parsed = parseMetrics(metrics);
  if (!parsed) {
    return (
      <p className="py-6 text-center font-mono text-xs text-muted">
        No chartable metrics for this run.
      </p>
    );
  }

  const data = parsed.points.map((p, i) => ({ ...p, t: p.t ?? i }));

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
        <CartesianGrid stroke="var(--border)" />
        <XAxis
          dataKey="t"
          tick={{ fill: "var(--text-muted)", fontFamily: "var(--font-plex-mono)", fontSize: 11 }}
          stroke="var(--border)"
        />
        <YAxis
          tick={{ fill: "var(--text-muted)", fontFamily: "var(--font-plex-mono)", fontSize: 11 }}
          stroke="var(--border)"
        />
        <Tooltip
          contentStyle={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            fontFamily: "var(--font-plex-mono)",
            fontSize: 12,
            color: "var(--text-primary)",
          }}
        />
        {parsed.keys.map((key, i) => (
          <Line
            key={key}
            type="monotone"
            dataKey={key}
            stroke={LINE_COLORS[i % LINE_COLORS.length]}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
