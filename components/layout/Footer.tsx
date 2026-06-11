import Link from "next/link";

const TAXONOMY = [
  { label: "ESTABLISHED", color: "var(--signal-strong)" },
  { label: "STRONG EVIDENCE", color: "var(--signal-strong)" },
  { label: "PLAUSIBLE", color: "var(--signal-mid)" },
  { label: "SPECULATION", color: "var(--signal-weak)" },
  { label: "UNKNOWN", color: "var(--signal-unknown)" },
];

export function Footer() {
  return (
    <footer className="mt-16 border-t border-edge bg-surface">
      <div className="mx-auto grid max-w-content gap-10 px-4 py-12 sm:px-6 md:grid-cols-3">
        <div className="space-y-3">
          <p className="font-display text-lg font-medium text-ink">VERITAS</p>
          <p className="max-w-xs text-sm text-muted">
            An observatory for knowledge: a living map of what humanity knows,
            suspects, and cannot yet answer. The interface never looks more
            certain than the knowledge it displays.
          </p>
        </div>

        <nav aria-label="Footer" className="grid grid-cols-2 gap-2 text-sm">
          <Link className="text-muted hover:text-ink" href="/dashboard">Reality Dashboard</Link>
          <Link className="text-muted hover:text-ink" href="/hypotheses">Hypothesis Database</Link>
          <Link className="text-muted hover:text-ink" href="/questions">Unanswered Questions</Link>
          <Link className="text-muted hover:text-ink" href="/evidence">Evidence Library</Link>
          <Link className="text-muted hover:text-ink" href="/timeline">Timeline</Link>
          <Link className="text-muted hover:text-ink" href="/graph">Research Graph</Link>
          <Link className="text-muted hover:text-ink" href="/lab">Simulation Lab</Link>
          <Link className="text-muted hover:text-ink" href="/admin">Admin</Link>
        </nav>

        <div className="space-y-3">
          <p className="eyebrow">Epistemic taxonomy</p>
          <ul className="space-y-1.5">
            {TAXONOMY.map((t) => (
              <li key={t.label} className="flex items-center gap-2 font-mono text-xs text-muted">
                <span
                  aria-hidden
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: t.color }}
                />
                {t.label}
              </li>
            ))}
          </ul>
          <p className="pt-2 text-xs text-muted">
            Unknown is a state of the map, not an error.
          </p>
        </div>
      </div>
      <div className="border-t border-edge">
        <div className="mx-auto flex max-w-content items-center justify-between px-4 py-4 font-mono text-xs text-muted sm:px-6">
          <span>VERITAS V1.0</span>
          <span>Built to outlast its assumptions.</span>
        </div>
      </div>
    </footer>
  );
}
