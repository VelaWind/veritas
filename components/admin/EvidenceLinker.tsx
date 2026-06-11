"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { inputClass } from "@/components/ui/Field";
import { api } from "@/lib/client-api";
import type { EvidenceLinkFull, EvidenceRelation } from "@/types/domain";

const RELATIONS: EvidenceRelation[] = ["supports", "opposes", "neutral"];

/**
 * Links evidence to a hypothesis (§6 POST/DELETE /api/hypotheses/[id]/evidence).
 * The DB trigger creates the graph edge and the timeline event.
 */
export function EvidenceLinker({
  hypothesisId,
  links,
  allEvidence,
}: {
  hypothesisId: string;
  links: EvidenceLinkFull[];
  allEvidence: Array<{ id: string; slug: string; title: string; strength: number }>;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [relation, setRelation] = useState<EvidenceRelation>("supports");
  const [weight, setWeight] = useState(50);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const linkedIds = useMemo(
    () => new Set(links.map((l) => l.evidence.id)),
    [links],
  );
  const candidates = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return allEvidence
      .filter((e) => !linkedIds.has(e.id))
      .filter((e) => !q || e.title.toLowerCase().includes(q))
      .slice(0, 30);
  }, [allEvidence, linkedIds, filter]);

  async function link(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId) {
      setError("Choose evidence to link.");
      return;
    }
    setError(null);
    setInfo(null);
    setPending(true);
    const res = await api.post<{ suggested_confidence: number | null }>(
      `/api/hypotheses/${hypothesisId}/evidence`,
      { evidenceId: selectedId, relation, weight, notes },
    );
    setPending(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setInfo(
      res.data?.suggested_confidence != null
        ? `Linked. Evidence model now suggests confidence ${res.data.suggested_confidence}.`
        : "Linked.",
    );
    setSelectedId("");
    setNotes("");
    router.refresh();
  }

  async function unlink(evidenceId: string) {
    setError(null);
    setInfo(null);
    const res = await api.delete<{ suggested_confidence: number | null }>(
      `/api/hypotheses/${hypothesisId}/evidence`,
      { evidenceId },
    );
    if (res.error) {
      setError(res.error);
      return;
    }
    setInfo(
      res.data?.suggested_confidence != null
        ? `Unlinked. Evidence model now suggests confidence ${res.data.suggested_confidence}.`
        : "Unlinked.",
    );
    router.refresh();
  }

  return (
    <div className="card space-y-5 p-6">
      <p className="eyebrow">Evidence linker</p>

      {links.length === 0 ? (
        <p className="text-sm text-muted">No evidence linked yet.</p>
      ) : (
        <ul className="divide-y divide-edge">
          {links.map((l) => (
            <li key={l.evidence.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <span
                className="w-20 shrink-0 font-mono text-xs uppercase"
                style={{
                  color:
                    l.relation === "supports"
                      ? "var(--signal-strong)"
                      : l.relation === "opposes"
                        ? "var(--contradiction)"
                        : "var(--text-muted)",
                }}
              >
                {l.relation}
              </span>
              <Link
                href={`/evidence/${l.evidence.slug}`}
                className="min-w-0 flex-1 truncate text-sm text-ink hover:text-accent"
              >
                {l.evidence.title}
              </Link>
              <span className="font-mono text-xs text-muted">w{l.weight}</span>
              <Button size="sm" variant="ghost" onClick={() => unlink(l.evidence.id)}>
                Unlink
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={link} className="space-y-3 border-t border-edge pt-4">
        <input
          aria-label="Filter evidence"
          placeholder="Filter evidence by title…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className={inputClass}
        />
        <select
          aria-label="Evidence to link"
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className={inputClass}
        >
          <option value="">— choose evidence ({candidates.length} shown) —</option>
          {candidates.map((e) => (
            <option key={e.id} value={e.id}>
              {e.title} (strength {e.strength})
            </option>
          ))}
        </select>
        <div className="grid gap-3 sm:grid-cols-3">
          <select
            aria-label="Relation"
            value={relation}
            onChange={(e) => setRelation(e.target.value as EvidenceRelation)}
            className={inputClass}
          >
            {RELATIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <input
            aria-label="Weight"
            type="number"
            min={0}
            max={100}
            value={weight}
            onChange={(e) => setWeight(Number(e.target.value))}
            className={inputClass}
          />
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Linking…" : "Link evidence"}
          </Button>
        </div>
        <input
          aria-label="Link notes"
          placeholder="Notes — why this evidence bears on this hypothesis"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className={inputClass}
        />
      </form>

      {error && (
        <p role="alert" className="text-sm" style={{ color: "var(--contradiction)" }}>
          {error}
        </p>
      )}
      {info && <p className="text-sm text-muted">{info}</p>}
    </div>
  );
}
