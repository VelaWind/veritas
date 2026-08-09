"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";

/**
 * Root error boundary. The Phase 5 boundaries are scoped to route groups —
 * app/(public)/error.tsx does not cover /contribute or /(auth) — so anything
 * outside those segments previously fell through to global-error.tsx, which
 * throws away the layout and reads as a crash.
 *
 * The copy matters as much as the boundary: a query that fails now throws
 * rather than returning an empty array, and the reader must be able to tell a
 * fault from an absence. "No hypotheses match your filters" is a fact about
 * the knowledge base; this page is a fact about the instrument.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surfaced to the platform's logs; no PII in our error messages.
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-content flex-col items-start gap-6 px-4 py-24 sm:px-6">
      <p className="eyebrow" style={{ color: "var(--signal-mid)" }}>
        Instrument error
      </p>
      <h1 className="max-w-2xl font-display text-2xl font-light text-ink">
        This data could not be loaded.
      </h1>
      <p className="max-w-xl text-muted">
        Something went wrong reaching the record — this is a fault in the
        instrument, not an empty result. Nothing here should be read as an
        absence of evidence. Retry, or return to a known-good surface.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button variant="primary" onClick={reset}>
          Try again
        </Button>
        <Link
          href="/"
          className="rounded border border-edge bg-surface px-4 py-2 text-sm text-ink transition-colors hover:bg-raised"
        >
          Home
        </Link>
      </div>
      {error.digest && (
        <p className="font-mono text-xs text-muted">ref: {error.digest}</p>
      )}
    </div>
  );
}
