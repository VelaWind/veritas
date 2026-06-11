"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, inputClass } from "@/components/ui/Field";
import { api } from "@/lib/client-api";
import { CONTRADICTION_KIND_META } from "@/lib/knowledge-engine/contradiction";
import type { ContradictionWithPartners } from "@/types/domain";
import { formatDate } from "@/lib/utils";

export function ContradictionQueue({
  items,
}: {
  items: ContradictionWithPartners[];
}) {
  const router = useRouter();
  const [resolving, setResolving] = useState<ContradictionWithPartners | null>(null);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function resolve() {
    if (!resolving) return;
    setError(null);
    if (notes.trim() === "") {
      setError("Resolution notes are required.");
      return;
    }
    setPending(true);
    const res = await api.patch(`/api/contradictions/${resolving.id}`, {
      resolved: true,
      resolution_notes: notes.trim(),
    });
    setPending(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setResolving(null);
    setNotes("");
    router.refresh();
  }

  async function reopen(id: string) {
    await api.patch(`/api/contradictions/${id}`, {
      resolved: false,
      resolution_notes: "",
    });
    router.refresh();
  }

  if (items.length === 0) {
    return (
      <p className="card p-8 text-center text-sm text-muted">
        No contradictions on record. Run a scan to check the current evidence
        links.
      </p>
    );
  }

  return (
    <>
      <ul className="space-y-3">
        {items.map((c) => (
          <li
            key={c.id}
            className="card border-l-2 p-4"
            style={{
              borderLeftColor: c.resolved ? "var(--border)" : "var(--contradiction)",
            }}
          >
            <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-muted">
              <span
                style={{
                  color: c.resolved ? "var(--text-muted)" : "var(--contradiction)",
                }}
              >
                {c.resolved ? "RESOLVED" : "OPEN"}
              </span>
              <span>·</span>
              <span>{CONTRADICTION_KIND_META[c.kind].label}</span>
              <span>·</span>
              <span>{formatDate(c.created_at)}</span>
              <span>·</span>
              <span>detected by {c.detected_by}</span>
            </div>

            <p className="mt-2 text-sm text-ink">{c.explanation}</p>

            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              {c.a ? (
                <Link href={`/hypotheses/${c.a.slug}`} className="link">
                  {c.a.title}
                </Link>
              ) : (
                <span className="text-muted">(hidden draft)</span>
              )}
              <span className="text-muted">vs</span>
              {c.b ? (
                <Link href={`/hypotheses/${c.b.slug}`} className="link">
                  {c.b.title}
                </Link>
              ) : (
                <span className="text-muted">(hidden draft)</span>
              )}
            </div>

            {c.resolved && c.resolution_notes && (
              <p className="mt-2 border-t border-edge pt-2 text-sm text-muted">
                Resolution: {c.resolution_notes}
              </p>
            )}

            <div className="mt-3">
              {c.resolved ? (
                <Button size="sm" onClick={() => reopen(c.id)}>
                  Reopen
                </Button>
              ) : (
                <Button size="sm" variant="primary" onClick={() => setResolving(c)}>
                  Resolve…
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>

      <Dialog
        open={resolving !== null}
        onClose={() => setResolving(null)}
        title="Resolve contradiction"
      >
        <p className="text-sm text-muted">{resolving?.explanation}</p>
        <div className="mt-4 space-y-4">
          <Field
            label="Resolution notes (required)"
            hint="How was this reconciled — superseded hypothesis, reinterpreted evidence, narrowed claims?"
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
            <Button variant="primary" onClick={resolve} disabled={pending}>
              {pending ? "Resolving…" : "Mark resolved"}
            </Button>
            <Button onClick={() => setResolving(null)}>Cancel</Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
