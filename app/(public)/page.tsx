import Link from "next/link";

// Phase 0 shell — replaced with data-driven sections in Phase 2.
export default function HomePage() {
  return (
    <div className="mx-auto max-w-content px-4 sm:px-6">
      <section className="flex flex-col items-start gap-6 py-24">
        <p className="eyebrow">An observatory for knowledge</p>
        <h1 className="max-w-3xl font-display text-2xl font-light text-ink sm:text-3xl">
          A living map of what humanity knows, suspects, and cannot yet answer.
        </h1>
        <p className="max-w-2xl text-lg text-muted">
          Every claim in Veritas carries its epistemic status, a confidence
          score with a recorded rationale, and the evidence for and against it.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/hypotheses"
            className="rounded bg-accent px-5 py-2.5 text-sm font-medium text-void transition-opacity hover:opacity-90"
          >
            Explore the hypotheses
          </Link>
          <Link
            href="/questions"
            className="rounded border border-edge bg-surface px-5 py-2.5 text-sm text-ink transition-colors hover:bg-raised"
          >
            The unanswered questions
          </Link>
        </div>
      </section>
    </div>
  );
}
