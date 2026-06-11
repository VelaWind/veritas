"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Field, inputClass } from "@/components/ui/Field";
import { MarkdownEditor } from "@/components/admin/MarkdownEditor";
import { api } from "@/lib/client-api";
import {
  EPISTEMIC_STATUSES,
  HYPOTHESIS_STATES,
  STATE_LABELS,
  STATUS_META,
} from "@/lib/knowledge-engine/taxonomy";
import {
  hypothesisCreateSchema,
  hypothesisUpdateSchema,
} from "@/lib/validations";
import type { Assumption, Hypothesis, OpenQuestionItem } from "@/types/domain";
import { slugify } from "@/lib/utils";

interface Props {
  domains: Array<{ id: string; name: string }>;
  questions: Array<{ id: string; title: string; domain_id: string }>;
  initial?: Hypothesis;
}

export function HypothesisForm({ domains, questions, initial }: Props) {
  const router = useRouter();
  const editing = Boolean(initial);

  const [title, setTitle] = useState(initial?.title ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(editing);
  const [domainId, setDomainId] = useState(initial?.domain_id ?? domains[0]?.id ?? "");
  const [questionId, setQuestionId] = useState(initial?.question_id ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [status, setStatus] = useState(initial?.status ?? "speculation");
  const [state, setState] = useState(initial?.state ?? "draft");
  const [confidence, setConfidence] = useState(initial?.confidence ?? 0);
  const [rationale, setRationale] = useState(initial?.confidence_rationale ?? "");
  const [assumptions, setAssumptions] = useState<Assumption[]>(
    initial?.assumptions ?? [],
  );
  const [openQuestions, setOpenQuestions] = useState<OpenQuestionItem[]>(
    initial?.open_questions ?? [],
  );
  const [falsification, setFalsification] = useState(
    initial?.falsification_criteria ?? "",
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const domainQuestions = useMemo(
    () => questions.filter((q) => q.domain_id === domainId),
    [questions, domainId],
  );
  const band = STATUS_META[status];

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const payload: Record<string, unknown> = {
      title,
      slug: slugTouched && slug ? slug : slugify(title),
      domain_id: domainId,
      question_id: questionId || null,
      description,
      status,
      state,
      assumptions,
      open_questions: openQuestions,
      falsification_criteria: falsification,
    };
    if (!editing) {
      payload.confidence = confidence;
      payload.confidence_rationale = rationale;
    }

    const schema = editing ? hypothesisUpdateSchema : hypothesisCreateSchema;
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join(" · "));
      return;
    }

    setPending(true);
    const res = editing
      ? await api.patch<Hypothesis>(`/api/hypotheses/${initial!.id}`, parsed.data)
      : await api.post<Hypothesis>("/api/hypotheses", parsed.data);
    setPending(false);

    if (res.error || !res.data) {
      setError(res.error ?? "Unknown error");
      return;
    }
    if (editing) {
      router.refresh();
    } else {
      router.push(`/admin/hypotheses/${res.data.id}`);
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

        <Field label="Slug" hint="URL identifier — stable once published.">
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
              onChange={(e) => {
                setDomainId(e.target.value);
                setQuestionId("");
              }}
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

        <Field
          label="Parent question"
          hint="Optional — the unanswered question this hypothesis addresses."
          className="sm:col-span-2"
        >
          {(id) => (
            <select
              id={id}
              value={questionId}
              onChange={(e) => setQuestionId(e.target.value)}
              className={inputClass}
            >
              <option value="">— none —</option>
              {domainQuestions.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.title}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>

      <Field label="Description (markdown)">
        {(id) => (
          <MarkdownEditor id={id} value={description} onChange={setDescription} rows={10} />
        )}
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Epistemic status"
          hint={`Permitted confidence band: ${band.min}–${band.max} (DB-enforced).`}
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
                  {STATUS_META[s].label} ({STATUS_META[s].min}–{STATUS_META[s].max})
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field
          label="State"
          hint="Activation requires a non-empty confidence rationale."
        >
          {(id) => (
            <select
              id={id}
              value={state}
              onChange={(e) => setState(e.target.value as typeof state)}
              className={inputClass}
            >
              {HYPOTHESIS_STATES.map((s) => (
                <option key={s} value={s}>
                  {STATE_LABELS[s]}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>

      {!editing && (
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={`Initial confidence (${band.min}–${band.max})`}>
            {(id) => (
              <input
                id={id}
                type="number"
                min={0}
                max={100}
                value={confidence}
                onChange={(e) => setConfidence(Number(e.target.value))}
                className={inputClass}
              />
            )}
          </Field>
          <Field
            label="Confidence rationale"
            hint="Mandatory before activation; every later change is audited."
          >
            {(id) => (
              <textarea
                id={id}
                rows={3}
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
                className={inputClass}
              />
            )}
          </Field>
        </div>
      )}

      {editing && (
        <p className="rounded border border-edge bg-raised px-3 py-2 text-xs text-muted">
          Confidence is edited in the dedicated Confidence editor below — every
          change requires a rationale and is recorded in confidence_history.
        </p>
      )}

      <fieldset className="space-y-3">
        <legend className="eyebrow">Assumptions</legend>
        {assumptions.map((a, i) => (
          <div key={i} className="grid gap-2 rounded border border-edge p-3 sm:grid-cols-[1fr_auto_auto]">
            <input
              aria-label={`Assumption ${i + 1} text`}
              value={a.text}
              onChange={(e) =>
                setAssumptions(
                  assumptions.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)),
                )
              }
              placeholder="Assumption"
              className={inputClass}
            />
            <label className="flex items-center gap-2 text-xs text-muted">
              <input
                type="checkbox"
                checked={a.justified}
                onChange={(e) =>
                  setAssumptions(
                    assumptions.map((x, j) =>
                      j === i ? { ...x, justified: e.target.checked } : x,
                    ),
                  )
                }
              />
              justified
            </label>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setAssumptions(assumptions.filter((_, j) => j !== i))}
            >
              Remove
            </Button>
            <input
              aria-label={`Assumption ${i + 1} notes`}
              value={a.notes ?? ""}
              onChange={(e) =>
                setAssumptions(
                  assumptions.map((x, j) => (j === i ? { ...x, notes: e.target.value } : x)),
                )
              }
              placeholder="Notes (optional)"
              className={`${inputClass} sm:col-span-3`}
            />
          </div>
        ))}
        <Button
          size="sm"
          onClick={() => setAssumptions([...assumptions, { text: "", justified: false }])}
        >
          Add assumption
        </Button>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="eyebrow">Open questions</legend>
        {openQuestions.map((q, i) => (
          <div key={i} className="flex gap-2">
            <input
              aria-label={`Open question ${i + 1}`}
              value={q.text}
              onChange={(e) =>
                setOpenQuestions(
                  openQuestions.map((x, j) => (j === i ? { text: e.target.value } : x)),
                )
              }
              className={inputClass}
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setOpenQuestions(openQuestions.filter((_, j) => j !== i))}
            >
              Remove
            </Button>
          </div>
        ))}
        <Button size="sm" onClick={() => setOpenQuestions([...openQuestions, { text: "" }])}>
          Add open question
        </Button>
      </fieldset>

      <Field
        label="Falsification criteria"
        hint="What observation would force this hypothesis to be revised or retired?"
      >
        {(id) => (
          <textarea
            id={id}
            rows={4}
            value={falsification}
            onChange={(e) => setFalsification(e.target.value)}
            className={inputClass}
          />
        )}
      </Field>

      {error && (
        <p role="alert" className="text-sm" style={{ color: "var(--contradiction)" }}>
          {error}
        </p>
      )}

      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Saving…" : editing ? "Save changes" : "Create hypothesis"}
      </Button>
    </form>
  );
}
