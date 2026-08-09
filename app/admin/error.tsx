"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/Button";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="space-y-5 py-8">
      <p className="eyebrow" style={{ color: "var(--signal-mid)" }}>
        Admin error
      </p>
      <h1 className="font-display text-xl font-light text-ink">
        This admin view could not be loaded.
      </h1>
      <p className="max-w-xl text-sm text-muted">
        The action or query failed — this is a fault, not an empty result. Do
        not treat the missing rows as absent data.
      </p>
      <p className="max-w-xl font-mono text-xs text-muted">
        {error.message || "An unexpected error occurred."}
      </p>
      <Button variant="primary" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
