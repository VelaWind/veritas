"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CONFIDENCE_BANDS } from "@/lib/knowledge-engine/taxonomy";

const BAND_VARS = [
  "--signal-unknown",
  "--signal-weak",
  "--signal-mid",
  "--signal-strong",
  "--signal-strong",
];

/**
 * §2.10 confidence_distribution is jsonb {bucket: count} where bucket is
 * width_bucket(confidence,0,100,5) → 1..5 (and 6 for an exact 100). Map to the
 * five named bands; fold the overflow bucket 6 into "Very Strong".
 */
export function ConfidenceDistribution({
  distribution,
}: {
  distribution: Record<string, number> | null;
}) {
  const data = CONFIDENCE_BANDS.map((band, i) => {
    const bucket = i + 1;
    let count = distribution?.[String(bucket)] ?? 0;
    if (bucket === 5) count += distribution?.["6"] ?? 0;
    return { name: band.label, range: `${band.from}–${band.to}`, count, varName: BAND_VARS[i] };
  });

  const total = data.reduce((s, d) => s + d.count, 0);
  if (total === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted">
        No confidence data yet.
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: -16 }}>
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey="range"
          tick={{ fill: "var(--text-muted)", fontFamily: "var(--font-plex-mono)", fontSize: 11 }}
          stroke="var(--border)"
        />
        <YAxis
          allowDecimals={false}
          tick={{ fill: "var(--text-muted)", fontFamily: "var(--font-plex-mono)", fontSize: 11 }}
          stroke="var(--border)"
        />
        <Tooltip
          cursor={{ fill: "var(--bg-raised)" }}
          contentStyle={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            fontFamily: "var(--font-plex-mono)",
            fontSize: 12,
            color: "var(--text-primary)",
          }}
          formatter={(value: number) => [`${value} hypotheses`, ""]}
          labelFormatter={(label, payload) =>
            `${payload?.[0]?.payload?.name ?? ""} (${label})`
          }
        />
        <Bar dataKey="count" radius={[3, 3, 0, 0]}>
          {data.map((d) => (
            <Cell key={d.name} fill={`var(${d.varName})`} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
