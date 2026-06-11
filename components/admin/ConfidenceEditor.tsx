"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfidenceMeter } from "@/components/epistemics/ConfidenceMeter";
import { Button } from "@/components/ui/Button";
import { Field, inputClass } from "@/components/ui/Field";
import { api } from "@/lib/client-api";
import { STATUS_META } from "@/lib/knowledge-engine/taxonomy";
import type {
  ConfidenceHistoryEntry,
  EpistemicStatus,
  Hypothesis,
} from "@/types/domain";

/**
 * §6 PATCH /api/hypotheses/[id]/confidence — value + MANDATORY rationale.
 * The DB trigger writes confidence_history and the timeline event; the
 * epistemics_consistent constraint rejects out-of-band values.
 */
export function ConfidenceEditor({
  hypothesisId,
  current,
  status,
  suggested,
  history,
  rationale,
}: {
  hypothesisId: string;
  current: number;
  status: EpistemicStatus;
  suggested: number | null;
  history: ConfidenceHistoryEntry[];
  rationale: string;
}) {
  const router = useRouter();
  const meta = STATUS_META[status];
  const [value, setValue] = useState(current);
  const [newRationale, setNewRationale] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (newRationale.trim() === "") {
      setError("A rationale is mandatory for confidence changes.");
      return;
    }
    setPending(true);
    const res = await api.patch<{
      hypothesis: Hypothesis;
      suggested_confidence: number | null;
    }>(`/api/hypotheses/${hypothesisId}/confidence`, {
      value,
      rationale: newRationale.trim(),
    });
    setPending(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setNewRationale("");
    router.refresh();
  }

  return (
    <div className="card space-y-5 p-6">
      <div>
        <p className="eyebrow">Confidence editor</p>
        <p className="mt-1 text-xs text-muted">
          Status “{meta.label}” permits {meta.min}–{meta.max}. The evidence
          model suggests{" "}
          <span className="font-mono text-ink">{suggested ?? "—"}</span>.
        </p>
      </div>

      <ConfidenceMeter
        value={current}
        suggested={suggested}
        rationale={rationale}
        history={history}
        animate={false}
      />

      <form onSubmit={onSubmit} className="space-y-4">
        <Field label={`New value (${meta.min}–${meta.max})`}>
          {(id) => (
            <div className="flex items-center gap-3">
              <input
                id={id}
                type="range"
                min={0}
                max={100}
                value={value}
                onChange={(e) => setValue(Number(e.target.value))}
                className="flex-1 accent-[var(--accent)]"
              />
              <input
                aria-label="New confidence value"
                type="number"
                min={0}
                max={100}
                value={value}
                onChange={(e) => setValue(Number(e.target.value))}
                className={`${inputClass} w-20`}
              />
            </div>
          )}
        </Field>

        <Field
          label="Rationale (required)"
          hint="Recorded verbatim in confidence_history — write for the next decade's reader."
        >
          {(id) => (
            <textarea
              id={id}
              rows={3}
              required
              value={newRationale}
              onChange={(e) => setNewRationale(e.target.value)}
              className={inputClass}
            />
          )}
        </Field>

        {error && (
          <p role="alert" className="text-sm" style={{ color: "var(--contradiction)" }}>
            {error}
          </p>
        )}

        <Button type="submit" variant="primary" disabled={pending || value === current}>
          {pending ? "Recording…" : `Set confidence to ${value}`}
        </Button>
      </form>
    </div>
  );
}
