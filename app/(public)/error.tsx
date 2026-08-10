"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";

export default function PublicError({
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
        This part of the map could not be loaded.
      </h1>
      <p className="max-w-xl text-muted">
        This is an error in the interface, not a statement about the knowledge
        itself — a fault, not an absence. Do not read it as &ldquo;there is
        nothing here&rdquo;. You can retry, or return to a known-good surface.
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
