"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export function DomainActivity({
  data,
}: {
  data: Array<{ name: string; n: number }> | null;
}) {
  const rows = (data ?? []).filter((d) => d.n > 0);
  if (rows.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted">No activity yet.</p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={Math.max(220, rows.length * 34)}>
      <BarChart
        data={rows}
        layout="vertical"
        margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
      >
        <CartesianGrid stroke="var(--border)" horizontal={false} />
        <XAxis
          type="number"
          allowDecimals={false}
          tick={{ fill: "var(--text-muted)", fontFamily: "var(--font-plex-mono)", fontSize: 11 }}
          stroke="var(--border)"
        />
        <YAxis
          type="category"
          dataKey="name"
          width={130}
          tick={{ fill: "var(--text-muted)", fontFamily: "var(--font-inter)", fontSize: 12 }}
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
        />
        <Bar dataKey="n" fill="var(--accent)" radius={[0, 3, 3, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
