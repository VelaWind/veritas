"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Field, inputClass } from "@/components/ui/Field";
import { MarkdownEditor } from "@/components/admin/MarkdownEditor";
import { api } from "@/lib/client-api";
import type { Domain } from "@/types/domain";
import { slugify } from "@/lib/utils";

export function DomainForm({ initial }: { initial?: Domain }) {
  const router = useRouter();
  const editing = Boolean(initial);

  const [name, setName] = useState(initial?.name ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(editing);
  const [overview, setOverview] = useState(initial?.overview ?? "");
  const [icon, setIcon] = useState(initial?.icon ?? "");
  const [sortOrder, setSortOrder] = useState(initial?.sort_order ?? 0);
  const [researchStatus, setResearchStatus] = useState(initial?.research_status ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);

    const payload = {
      name,
      slug: slugTouched && slug ? slug : slugify(name),
      overview,
      icon: icon || null,
      sort_order: sortOrder,
      research_status: researchStatus,
    };

    const res = editing
      ? await api.patch<Domain>(`/api/domains/${initial!.id}`, payload)
      : await api.post<Domain>("/api/domains", payload);
    setPending(false);

    if (res.error || !res.data) {
      setError(res.error ?? "Unknown error");
      return;
    }
    router.push("/admin/domains");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Name">
          {(id) => (
            <input
              id={id}
              required
              value={name}
              onChange={(e) => {
                setName(e.target.value);
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
        <Field label="Icon" hint="lucide icon name, e.g. 'atom', 'brain'.">
          {(id) => (
            <input
              id={id}
              value={icon ?? ""}
              onChange={(e) => setIcon(e.target.value)}
              className={inputClass}
            />
          )}
        </Field>
        <Field label="Sort order">
          {(id) => (
            <input
              id={id}
              type="number"
              min={0}
              value={sortOrder}
              onChange={(e) => setSortOrder(Number(e.target.value))}
              className={inputClass}
            />
          )}
        </Field>
      </div>

      <Field label="Overview (markdown)">
        {(id) => <MarkdownEditor id={id} value={overview} onChange={setOverview} rows={5} />}
      </Field>
      <Field label="Research status" hint="Prose summary of the state of the field.">
        {(id) => (
          <MarkdownEditor
            id={id}
            value={researchStatus}
            onChange={setResearchStatus}
            rows={5}
          />
        )}
      </Field>

      {error && (
        <p role="alert" className="text-sm" style={{ color: "var(--contradiction)" }}>
          {error}
        </p>
      )}

      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Saving…" : editing ? "Save changes" : "Add domain"}
      </Button>
    </form>
  );
}
