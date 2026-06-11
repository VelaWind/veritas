"use client";

import { Area, AreaChart, ResponsiveContainer } from "recharts";

/** Tiny single-hue area sparkline used in stat cards and run summaries. */
export function ActivitySparkline({
  data,
  color = "var(--accent)",
  height = 40,
}: {
  data: number[];
  color?: string;
  height?: number;
}) {
  if (!data || data.length < 2) return null;
  const chartData = data.map((value, i) => ({ i, value }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={chartData} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={1.5}
          fill="url(#spark)"
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
