"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Field, inputClass } from "@/components/ui/Field";
import { MarkdownEditor } from "@/components/admin/MarkdownEditor";
import { api } from "@/lib/client-api";
import type { ResearchNote } from "@/types/domain";
import { slugify } from "@/lib/utils";

export function NoteForm({ initial }: { initial?: ResearchNote }) {
  const router = useRouter();
  const editing = Boolean(initial);

  const [title, setTitle] = useState(initial?.title ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(editing);
  const [body, setBody] = useState(initial?.body ?? "");
  const [published, setPublished] = useState(initial?.published ?? false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);

    const payload = {
      title,
      slug: slugTouched && slug ? slug : slugify(title),
      body,
      published,
    };

    const res = editing
      ? await api.patch<ResearchNote>(`/api/notes/${initial!.id}`, payload)
      : await api.post<ResearchNote>("/api/notes", payload);
    setPending(false);

    if (res.error || !res.data) {
      setError(res.error ?? "Unknown error");
      return;
    }
    router.push("/admin/notes");
    router.refresh();
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
        <Field label="Visibility" hint="Publishing emits a timeline event.">
          {(id) => (
            <label htmlFor={id} className="flex items-center gap-2 pt-2 text-sm text-ink">
              <input
                id={id}
                type="checkbox"
                checked={published}
                onChange={(e) => setPublished(e.target.checked)}
              />
              Published
            </label>
          )}
        </Field>
      </div>

      <Field label="Body (markdown)">
        {(id) => <MarkdownEditor id={id} value={body} onChange={setBody} rows={16} />}
      </Field>

      {error && (
        <p role="alert" className="text-sm" style={{ color: "var(--contradiction)" }}>
          {error}
        </p>
      )}

      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Saving…" : editing ? "Save changes" : "Create note"}
      </Button>
    </form>
  );
}
