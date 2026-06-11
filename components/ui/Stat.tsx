export function Stat({
  value,
  label,
  accent,
}: {
  value: string | number;
  label: string;
  accent?: boolean;
}) {
  return (
    <div className="card p-5">
      <p
        className="font-mono text-2xl tabular-nums"
        style={{ color: accent ? "var(--accent)" : "var(--text-primary)" }}
      >
        {value}
      </p>
      <p className="mt-1 text-xs text-muted">{label}</p>
    </div>
  );
}
