"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, inputClass } from "@/components/ui/Field";
import { api } from "@/lib/client-api";
import { formatDate } from "@/lib/utils";
import type { SuggestionStatus, SuggestionWithProposer } from "@/types/domain";
import { CritiquePanel } from "./CritiquePanel";

const STATUS_COLOR: Record<SuggestionStatus, string> = {
  pending: "var(--signal-mid)",
  approved: "var(--signal-strong)",
  rejected: "var(--signal-weak)",
  withdrawn: "var(--text-muted)",
};

const DETAIL_PREFIX: Record<"hypothesis" | "evidence", string> = {
  hypothesis: "/hypotheses",
  evidence: "/evidence",
};

/** Render a payload as readable key/value rows (scalars inline, structures as JSON). */
function PayloadView({ payload }: { payload: Record<string, unknown> }) {
  const entries = Object.entries(payload).filter(
    ([, v]) => v !== null && v !== undefined && v !== "",
  );
  if (entries.length === 0) {
    return <p className="text-xs text-muted">No fields.</p>;
  }
  return (
    <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[160px_1fr]">
      {entries.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="font-mono text-xs uppercase tracking-wide text-muted">{k}</dt>
          <dd className="min-w-0 break-words text-sm text-ink">
            {typeof v === "object" ? (
              <code className="font-mono text-xs">{JSON.stringify(v)}</code>
            ) : (
              String(v)
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function SuggestionQueue({ items }: { items: SuggestionWithProposer[] }) {
  const router = useRouter();
  const [rejecting, setRejecting] = useState<SuggestionWithProposer | null>(null);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function approve(s: SuggestionWithProposer) {
    setError(null);
    setPendingId(s.id);
    const res = await api.post(`/api/suggestions/${s.id}/approve`, {});
    setPendingId(null);
    if (res.error) {
      setError(`${s.id}: ${res.error}`);
      return;
    }
    router.refresh();
  }

  async function reject() {
    if (!rejecting) return;
    if (notes.trim() === "") {
      setError("A short reason is required to reject.");
      return;
    }
    setPendingId(rejecting.id);
    const res = await api.post(`/api/suggestions/${rejecting.id}/reject`, {
      notes: notes.trim(),
    });
    setPendingId(null);
    if (res.error) {
      setError(res.error);
      return;
    }
    setRejecting(null);
    setNotes("");
    router.refresh();
  }

  if (items.length === 0) {
    return (
      <p className="card p-8 text-center text-sm text-muted">
        No suggestions in this view.
      </p>
    );
  }

  return (
    <>
      <ul className="space-y-3">
        {items.map((s) => {
          const title = (s.payload.title as string) ?? "(untitled)";
          const slug = s.payload.slug as string | undefined;
          const isPending = s.status === "pending";
          return (
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
                <span>
                  {s.actor_type === "agent"
                    ? `agent: ${s.agent_name ?? "unknown"}`
                    : (s.proposer?.display_name ?? "unknown")}
                  {s.proposer?.role ? ` (${s.proposer.role})` : ""}
                </span>
                <span>·</span>
                <span>{formatDate(s.created_at)}</span>
              </div>

              <p className="mt-2 text-sm font-medium text-ink">{title}</p>

              {s.operation === "edit" && slug && (
                <Link
                  href={`${DETAIL_PREFIX[s.target_type]}/${slug}`}
                  className="link text-xs"
                >
                  View current {s.target_type} →
                </Link>
              )}

              {s.rationale && (
                <p className="mt-2 border-l-2 border-edge pl-3 text-sm text-muted">
                  {s.rationale}
                </p>
              )}

              <CritiquePanel critiques={s.critiques} />

              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-muted hover:text-ink">
                  Proposed fields
                </summary>
                <div className="mt-2 rounded border border-edge bg-void p-3">
                  <PayloadView payload={s.payload} />
                </div>
              </details>

              {!isPending && s.review_notes && (
                <p className="mt-2 border-t border-edge pt-2 text-sm text-muted">
                  Review note: {s.review_notes}
                </p>
              )}

              {isPending && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => approve(s)}
                    disabled={pendingId === s.id}
                  >
                    {pendingId === s.id ? "Applying…" : "Approve & apply"}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      setError(null);
                      setNotes("");
                      setRejecting(s);
                    }}
                    disabled={pendingId === s.id}
                  >
                    Reject…
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {error && (
        <p role="alert" className="mt-3 text-sm" style={{ color: "var(--contradiction)" }}>
          {error}
        </p>
      )}

      <Dialog
        open={rejecting !== null}
        onClose={() => setRejecting(null)}
        title="Reject suggestion"
      >
        <p className="text-sm text-muted">
          {(rejecting?.payload.title as string) ?? ""}
        </p>
        <div className="mt-4 space-y-4">
          <Field
            label="Reason (required)"
            hint="Shown to the proposer so they can revise and resubmit."
          >
            {(id) => (
              <textarea
                id={id}
                rows={4}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className={inputClass}
              />
            )}
          </Field>
          {error && (
            <p role="alert" className="text-sm" style={{ color: "var(--contradiction)" }}>
              {error}
            </p>
          )}
          <div className="flex gap-3">
            <Button
              variant="primary"
              onClick={reject}
              disabled={pendingId === rejecting?.id}
            >
              {pendingId === rejecting?.id ? "Rejecting…" : "Reject"}
            </Button>
            <Button onClick={() => setRejecting(null)}>Cancel</Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
