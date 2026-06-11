"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Field, inputClass } from "@/components/ui/Field";
import { MarkdownEditor } from "@/components/admin/MarkdownEditor";
import { api } from "@/lib/client-api";
import type {
  Simulation,
  SimulationCategory,
  SimulationStatus,
} from "@/types/domain";
import { slugify } from "@/lib/utils";

export const SIM_CATEGORIES: Array<{ value: SimulationCategory; label: string }> = [
  { value: "artificial_ecosystems", label: "Artificial Ecosystems" },
  { value: "agent_intelligence", label: "Agent Intelligence" },
  { value: "civilizations", label: "Civilizations" },
  { value: "universe_simulations", label: "Universe Simulations" },
  { value: "consciousness_experiments", label: "Consciousness Experiments" },
];

const SIM_STATUSES: SimulationStatus[] = [
  "planned",
  "running",
  "completed",
  "archived",
];

function parseJsonField(raw: string): Record<string, unknown> | null {
  if (!raw.trim()) return {};
  try {
    const value = JSON.parse(raw);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

export function SimulationForm({ initial }: { initial?: Simulation }) {
  const router = useRouter();
  const editing = Boolean(initial);

  const [title, setTitle] = useState(initial?.title ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(editing);
  const [category, setCategory] = useState<SimulationCategory>(
    initial?.category ?? "artificial_ecosystems",
  );
  const [status, setStatus] = useState<SimulationStatus>(initial?.status ?? "planned");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [parameters, setParameters] = useState(
    JSON.stringify(initial?.parameters ?? {}, null, 2),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const params = parseJsonField(parameters);
    if (params === null) {
      setError("Parameters must be a valid JSON object.");
      return;
    }

    setPending(true);
    const payload = {
      title,
      slug: slugTouched && slug ? slug : slugify(title),
      category,
      status,
      description,
      parameters: params,
    };

    const res = editing
      ? await api.patch<Simulation>(`/api/simulations/${initial!.id}`, payload)
      : await api.post<Simulation>("/api/simulations", payload);
    setPending(false);

    if (res.error || !res.data) {
      setError(res.error ?? "Unknown error");
      return;
    }
    if (editing) {
      router.refresh();
    } else {
      router.push(`/admin/simulations/${res.data.id}`);
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
        <Field label="Category">
          {(id) => (
            <select
              id={id}
              value={category}
              onChange={(e) => setCategory(e.target.value as SimulationCategory)}
              className={inputClass}
            >
              {SIM_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Status">
          {(id) => (
            <select
              id={id}
              value={status}
              onChange={(e) => setStatus(e.target.value as SimulationStatus)}
              className={inputClass}
            >
              {SIM_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
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

      <Field label="Parameters (JSON object)">
        {(id) => (
          <textarea
            id={id}
            rows={6}
            value={parameters}
            onChange={(e) => setParameters(e.target.value)}
            className={`${inputClass} font-mono`}
          />
        )}
      </Field>

      {error && (
        <p role="alert" className="text-sm" style={{ color: "var(--contradiction)" }}>
          {error}
        </p>
      )}

      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Saving…" : editing ? "Save changes" : "Create simulation"}
      </Button>
    </form>
  );
}

export function RunForm({ simulationId }: { simulationId: string }) {
  const router = useRouter();
  const [parameters, setParameters] = useState("{}");
  const [results, setResults] = useState("{}");
  const [metrics, setMetrics] = useState(
    '{\n  "series": [\n    { "t": 0, "value": 0 }\n  ]\n}',
  );
  const [finished, setFinished] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const p = parseJsonField(parameters);
    const r = parseJsonField(results);
    const m = parseJsonField(metrics);
    if (p === null || r === null || m === null) {
      setError("Parameters, results and metrics must each be valid JSON objects.");
      return;
    }

    setPending(true);
    const now = new Date().toISOString();
    const res = await api.post(`/api/simulations/${simulationId}/runs`, {
      parameters: p,
      results: r,
      metrics: m,
      started_at: now,
      finished_at: finished ? now : null,
    });
    setPending(false);

    if (res.error) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <p className="eyebrow">Record a run</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Parameters">
          {(id) => (
            <textarea
              id={id}
              rows={5}
              value={parameters}
              onChange={(e) => setParameters(e.target.value)}
              className={`${inputClass} font-mono`}
            />
          )}
        </Field>
        <Field label="Results">
          {(id) => (
            <textarea
              id={id}
              rows={5}
              value={results}
              onChange={(e) => setResults(e.target.value)}
              className={`${inputClass} font-mono`}
            />
          )}
        </Field>
        <Field label="Metrics" hint='Chartable: { "series": [{ "t": 0, ... }] }'>
          {(id) => (
            <textarea
              id={id}
              rows={5}
              value={metrics}
              onChange={(e) => setMetrics(e.target.value)}
              className={`${inputClass} font-mono`}
            />
          )}
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-muted">
        <input
          type="checkbox"
          checked={finished}
          onChange={(e) => setFinished(e.target.checked)}
        />
        Mark finished (emits simulation_completed timeline event)
      </label>

      {error && (
        <p role="alert" className="text-sm" style={{ color: "var(--contradiction)" }}>
          {error}
        </p>
      )}

      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Recording…" : "Record run"}
      </Button>
    </form>
  );
}
