"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { api } from "@/lib/client-api";
import { formatDate } from "@/lib/utils";
import type { SuggestionStatus, SuggestionWithProposer } from "@/types/domain";

const STATUS_COLOR: Record<SuggestionStatus, string> = {
  pending: "var(--signal-mid)",
  approved: "var(--signal-strong)",
  rejected: "var(--signal-weak)",
  withdrawn: "var(--text-muted)",
};

export function MySuggestions({ items }: { items: SuggestionWithProposer[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function withdraw(id: string) {
    if (!window.confirm("Withdraw this suggestion? It will no longer be reviewed.")) {
      return;
    }
    setPendingId(id);
    setError(null);
    const res = await api.post(`/api/suggestions/${id}/withdraw`, {});
    setPendingId(null);
    if (res.error) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  if (items.length === 0) {
    return (
      <p className="card p-8 text-center text-sm text-muted">
        You haven&rsquo;t proposed anything yet.
      </p>
    );
  }

  return (
    <>
      {error && (
        <p role="alert" className="mb-3 text-sm" style={{ color: "var(--contradiction)" }}>
          {error}
        </p>
      )}
      <ul className="space-y-3">
        {items.map((s) => (
          <li
            key={s.id}
            className="card border-l-2 p-4"
            style={{ borderLeftColor: STATUS_COLOR[s.status] }}
          >
            <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-muted">
              <span style={{ color: STATUS_COLOR[s.status] }}>
                {s.status.toUpperCase()}
              </span>
              <span>·</span>
              <span>
                {s.operation} {s.target_type}
              </span>
              <span>·</span>
              <span>{formatDate(s.created_at)}</span>
            </div>

            <p className="mt-2 text-sm font-medium text-ink">
              {(s.payload.title as string) ?? "(untitled)"}
            </p>

            {s.status === "rejected" && s.review_notes && (
              <p className="mt-2 border-l-2 pl-3 text-sm text-muted" style={{ borderColor: "var(--signal-weak)" }}>
                Reviewer: {s.review_notes}
              </p>
            )}

            {s.status === "pending" && (
              <div className="mt-3">
                <Button
                  size="sm"
                  onClick={() => withdraw(s.id)}
                  disabled={pendingId === s.id}
                >
                  {pendingId === s.id ? "Withdrawing…" : "Withdraw"}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
