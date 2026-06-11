import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-content flex-col items-start gap-6 px-4 py-24 sm:px-6">
      <p className="eyebrow">404 — Outside the map</p>
      <h1 className="max-w-2xl font-display text-2xl font-light text-ink">
        This region of the knowledge map is uncharted.
      </h1>
      <p className="max-w-xl text-muted">
        The page you are looking for does not exist — which is itself a kind of
        epistemic status. Return to surveyed territory below.
      </p>
      <div className="flex flex-wrap gap-3">
        <Link
          href="/"
          className="rounded border border-edge bg-surface px-4 py-2 text-sm text-ink transition-colors hover:bg-raised"
        >
          Home
        </Link>
        <Link
          href="/hypotheses"
          className="rounded border border-edge bg-surface px-4 py-2 text-sm text-ink transition-colors hover:bg-raised"
        >
          Hypothesis database
        </Link>
        <Link
          href="/search"
          className="rounded border border-edge bg-surface px-4 py-2 text-sm text-ink transition-colors hover:bg-raised"
        >
          Search
        </Link>
      </div>
    </div>
  );
}
