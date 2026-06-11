"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Field, inputClass } from "@/components/ui/Field";
import { MarkdownEditor } from "@/components/admin/MarkdownEditor";
import { api } from "@/lib/client-api";
import type { Evidence, Source, SourceType } from "@/types/domain";
import { slugify } from "@/lib/utils";

const SOURCE_TYPES: SourceType[] = [
  "peer_reviewed",
  "preprint",
  "book",
  "dataset",
  "experiment",
  "observation",
  "simulation_result",
  "philosophical_argument",
  "mathematical_proof",
  "other",
];

interface Props {
  sources: Array<Pick<Source, "id" | "title" | "year">>;
  domains: Array<{ id: string; name: string }>;
  initial?: Evidence;
}

export function EvidenceForm({ sources, domains, initial }: Props) {
  const router = useRouter();
  const editing = Boolean(initial);

  const [title, setTitle] = useState(initial?.title ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(editing);
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [strength, setStrength] = useState(initial?.strength ?? 50);
  const [domainId, setDomainId] = useState(initial?.domain_id ?? "");
  const [sourceMode, setSourceMode] = useState<"existing" | "new">("existing");
  const [sourceId, setSourceId] = useState(initial?.source_id ?? "");
  const [src, setSrc] = useState({
    title: "",
    authors: "",
    url: "",
    doi: "",
    source_type: "peer_reviewed" as SourceType,
    year: "" as string,
    reliability: 70,
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);

    const payload: Record<string, unknown> = {
      title,
      slug: slugTouched && slug ? slug : slugify(title),
      summary,
      strength,
      domain_id: domainId || null,
      source_id: sourceMode === "existing" ? sourceId || null : null,
      new_source:
        sourceMode === "new" && src.title.trim()
          ? {
              title: src.title,
              authors: src.authors || null,
              url: src.url || null,
              doi: src.doi || null,
              source_type: src.source_type,
              year: src.year ? Number(src.year) : null,
              reliability: src.reliability,
            }
          : null,
    };

    const res = editing
      ? await api.patch<Evidence>(`/api/evidence/${initial!.id}`, payload)
      : await api.post<Evidence>("/api/evidence", payload);
    setPending(false);

    if (res.error || !res.data) {
      setError(res.error ?? "Unknown error");
      return;
    }
    if (editing) {
      router.refresh();
    } else {
      router.push("/admin/evidence");
      router.refresh();
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Title" className="sm:col-span-2">
          {(id) => (
            <input
              id={id}
              required
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (!slugTouched) setSlug(slugify(e.target.value));
              }}
              className={inputClass}
            />
          )}
        </Field>
        <Field label="Slug">
          {(id) => (
            <input
              id={id}
              required
              value={slug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value);
              }}
              className={inputClass}
            />
          )}
        </Field>
        <Field label="Strength (0–100)" hint="How decisive is this evidence on its own?">
          {(id) => (
            <input
              id={id}
              type="number"
              min={0}
              max={100}
              value={strength}
              onChange={(e) => setStrength(Number(e.target.value))}
              className={inputClass}
            />
          )}
        </Field>
        <Field label="Domain (optional)">
          {(id) => (
            <select
              id={id}
              value={domainId ?? ""}
              onChange={(e) => setDomainId(e.target.value)}
              className={inputClass}
            >
              <option value="">— none —</option>
              {domains.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>

      <Field label="Summary (markdown)">
        {(id) => <MarkdownEditor id={id} value={summary} onChange={setSummary} rows={8} />}
      </Field>

      <fieldset className="space-y-3 rounded border border-edge p-4">
        <legend className="eyebrow px-1">Source</legend>
        <div className="flex gap-4 text-sm text-muted">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="sourceMode"
              checked={sourceMode === "existing"}
              onChange={() => setSourceMode("existing")}
            />
            Existing source
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="sourceMode"
              checked={sourceMode === "new"}
              onChange={() => setSourceMode("new")}
            />
            New source
          </label>
        </div>

        {sourceMode === "existing" ? (
          <select
            aria-label="Existing source"
            value={sourceId ?? ""}
            onChange={(e) => setSourceId(e.target.value)}
            className={inputClass}
          >
            <option value="">— no source —</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
                {s.year ? ` (${s.year})` : ""}
              </option>
            ))}
          </select>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              aria-label="Source title"
              placeholder="Source title *"
              value={src.title}
              onChange={(e) => setSrc({ ...src, title: e.target.value })}
              className={`${inputClass} sm:col-span-2`}
            />
            <input
              aria-label="Authors"
              placeholder="Authors"
              value={src.authors}
              onChange={(e) => setSrc({ ...src, authors: e.target.value })}
              className={inputClass}
            />
            <input
              aria-label="Year"
              placeholder="Year"
              type="number"
              value={src.year}
              onChange={(e) => setSrc({ ...src, year: e.target.value })}
              className={inputClass}
            />
            <input
              aria-label="URL"
              placeholder="URL"
              value={src.url}
              onChange={(e) => setSrc({ ...src, url: e.target.value })}
              className={inputClass}
            />
            <input
              aria-label="DOI"
              placeholder="DOI"
              value={src.doi}
              onChange={(e) => setSrc({ ...src, doi: e.target.value })}
              className={inputClass}
            />
            <select
              aria-label="Source type"
              value={src.source_type}
              onChange={(e) =>
                setSrc({ ...src, source_type: e.target.value as SourceType })
              }
              className={inputClass}
            >
              {SOURCE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, " ")}
                </option>
              ))}
            </select>
            <input
              aria-label="Reliability"
              placeholder="Reliability 0–100"
              type="number"
              min={0}
              max={100}
              value={src.reliability}
              onChange={(e) => setSrc({ ...src, reliability: Number(e.target.value) })}
              className={inputClass}
            />
          </div>
        )}
      </fieldset>

      {error && (
        <p role="alert" className="text-sm" style={{ color: "var(--contradiction)" }}>
          {error}
        </p>
      )}

      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Saving…" : editing ? "Save changes" : "Add evidence"}
      </Button>
    </form>
  );
}
