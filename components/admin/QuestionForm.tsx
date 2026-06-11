"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Field, inputClass } from "@/components/ui/Field";
import { MarkdownEditor } from "@/components/admin/MarkdownEditor";
import { api } from "@/lib/client-api";
import { EPISTEMIC_STATUSES, STATUS_META } from "@/lib/knowledge-engine/taxonomy";
import type { Question } from "@/types/domain";
import { slugify } from "@/lib/utils";

interface Props {
  domains: Array<{ id: string; name: string }>;
  initial?: Question;
}

export function QuestionForm({ domains, initial }: Props) {
  const router = useRouter();
  const editing = Boolean(initial);

  const [title, setTitle] = useState(initial?.title ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(editing);
  const [domainId, setDomainId] = useState(initial?.domain_id ?? domains[0]?.id ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [importance, setImportance] = useState(initial?.importance ?? 50);
  const [status, setStatus] = useState(initial?.status ?? "unknown");
  const [explanations, setExplanations] = useState(initial?.current_explanations ?? "");
  const [progress, setProgress] = useState(initial?.research_progress ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);

    const payload = {
      title,
      slug: slugTouched && slug ? slug : slugify(title),
      domain_id: domainId,
      description,
      importance,
      status,
      current_explanations: explanations,
      research_progress: progress,
    };

    const res = editing
      ? await api.patch<Question>(`/api/questions/${initial!.id}`, payload)
      : await api.post<Question>("/api/questions", payload);
    setPending(false);

    if (res.error || !res.data) {
      setError(res.error ?? "Unknown error");
      return;
    }
    if (editing) {
      router.refresh();
    } else {
      router.push("/admin/questions");
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
        <Field label="Domain">
          {(id) => (
            <select
              id={id}
              value={domainId}
              onChange={(e) => setDomainId(e.target.value)}
              className={inputClass}
            >
              {domains.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Importance (0–100)">
          {(id) => (
            <input
              id={id}
              type="number"
              min={0}
              max={100}
              value={importance}
              onChange={(e) => setImportance(Number(e.target.value))}
              className={inputClass}
            />
          )}
        </Field>
        <Field
          label="Epistemic status"
          hint="How settled is the answer? Unanswered questions stay Unknown."
        >
          {(id) => (
            <select
              id={id}
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
              className={inputClass}
            >
              {EPISTEMIC_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_META[s].label}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>

      <Field label="Description (markdown)">
        {(id) => (
          <MarkdownEditor id={id} value={description} onChange={setDescription} rows={6} />
        )}
      </Field>
      <Field label="Current explanations (markdown)">
        {(id) => (
          <MarkdownEditor id={id} value={explanations} onChange={setExplanations} rows={6} />
        )}
      </Field>
      <Field label="Research progress (markdown)">
        {(id) => (
          <MarkdownEditor id={id} value={progress} onChange={setProgress} rows={6} />
        )}
      </Field>

      {error && (
        <p role="alert" className="text-sm" style={{ color: "var(--contradiction)" }}>
          {error}
        </p>
      )}

      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Saving…" : editing ? "Save changes" : "Add question"}
      </Button>
    </form>
  );
}
