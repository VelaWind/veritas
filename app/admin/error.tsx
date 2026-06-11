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
        This admin action failed.
      </h1>
      <p className="max-w-xl text-sm text-muted">
        {error.message || "An unexpected error occurred."}
      </p>
      <Button variant="primary" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
