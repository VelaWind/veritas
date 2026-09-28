// Internal Affairs — the report stage (DECISIONS §D.4, stage 4 second pass).
//
// THIS MODULE NEVER SEES THE FINDINGS THE RUNNER COMPUTED. It is handed an
// audit ID, reads that row BACK from agent_audits, and builds the prompt from
// what is stored. So the model writes FROM the stored findings in the literal
// sense: if the INSERT had not committed, there would be nothing here to read,
// and if the in-memory findings differed from the stored ones, the model would
// see the stored ones.
//
// It can write exactly two columns, and 0013 enforces that rather than trusting
// this file: `report` on success, `report_error` on failure. findings, severity
// and public_summary are frozen at INSERT by a trigger that binds the service
// role too, and report_at is stamped by the database. So there is no code path
// from the model's output to the grade — not a disciplined one, an absent one.
//
// FAILURE IS A RECORDED OUTCOME, NEVER A ROLLBACK. The findings row committed
// before the model was called, and nothing here deletes or rewrites it. A model
// that is unreachable, errors, or returns empty or malformed output leaves
// report NULL and says why in report_error. The audit is still complete — the
// findings ARE the audit; the report is commentary on it.

/** Hard floor for "this is a report": below it, the output is a fragment. */
export const REPORT_MIN_CHARS = 80;
/** Hard ceiling. Above it the report is cut, and says so in its own text. */
export const REPORT_MAX_CHARS = 6000;

const DEFAULT_SYSTEM =
  "You are Internal Affairs for an AI research roster. You write the narrative " +
  "report for an audit whose findings were computed mechanically and are final.";

/**
 * Decide whether model output is a report. Pure — no I/O — so the rules are
 * unit-testable and cannot drift from what the runner enforces.
 *
 * Returns { ok: true, report } or { ok: false, reason }.
 */
export function parseReport(raw) {
  if (typeof raw !== "string") {
    return { ok: false, reason: `model output was ${raw === null ? "null" : typeof raw}, not text` };
  }
  // Reasoning models (qwen3, deepseek-r1 via Ollama) emit their scratchpad in
  // <think> tags. It is not the report, and an output that is ONLY a think
  // block — typically one cut off by max_tokens mid-thought — is empty.
  const text = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/i, "")
    .trim();
  if (text === "") {
    return {
      ok: false,
      reason: raw.trim() === "" ? "model returned empty output" : "model output contained only a reasoning block, no report",
    };
  }
  if (text.length < REPORT_MIN_CHARS) {
    return { ok: false, reason: `model output too short to be a report (${text.length} chars, minimum ${REPORT_MIN_CHARS})` };
  }
  // Printable-text check: a report is prose. Output dominated by control
  // characters or replacement glyphs is a decoding failure, not commentary.
  const junk = (text.match(/[\u0000-\u0008\u000E-\u001F\uFFFD]/g) ?? []).length;
  if (junk > text.length * 0.05) {
    return { ok: false, reason: `model output is not readable text (${junk} control/replacement characters)` };
  }
  if (text.length > REPORT_MAX_CHARS) {
    return {
      ok: true,
      report: `${text.slice(0, REPORT_MAX_CHARS)}\n\n[Report truncated at ${REPORT_MAX_CHARS} characters by the runner.]`,
    };
  }
  return { ok: true, report: text };
}

/**
 * The prompt, built from a STORED row. Takes the row, not findings, so it cannot
 * be called with anything that did not come back from the database.
 */
export function reportPrompt(row) {
  return [
    `Audit ${row.id} of agent "${row.agent_name || "(roster-wide)"}", run at ${row.run_at}.`,
    "",
    `Its severity is ${row.severity}. That grade was DERIVED from the findings below before you were`,
    "asked anything, it is stored, and nothing you write can change it. Do not restate a different",
    "grade, and do not argue that the grade should be different — explain it.",
    "",
    "FINDINGS (JSON, as stored):",
    JSON.stringify(row.findings, null, 2),
    "",
    "Write the report. Rules:",
    "- Every claim must come from the findings above. Refer to checks by number (#1–#6).",
    "  If something is not in the findings, you do not know it, and you do not say it.",
    "- A check whose status is not \"ran\" DID NOT RUN. Say so. Never read it as a clean result.",
    "- Each finding's `limits` field is binding. Do not claim coverage a check says it lacks.",
    "- Say plainly when the agent is doing fine. A clean audit is a result, not a gap.",
    "- Do not recommend or announce a sanction. The findings are graded; acting on them is not",
    "  this report's decision.",
    "- Plain prose, no headings, under 300 words.",
  ].join("\n");
}

/**
 * Run the report stage for one stored audit. Never throws: every outcome is a
 * returned value and, where the row allows it, a recorded one.
 *
 * @param {object} p
 * @param {import('@supabase/supabase-js').SupabaseClient} p.db   service-role client
 * @param {{complete: Function, describe: Function} | null} p.llm  null = no provider could be built
 * @param {string} p.auditId
 * @param {string | null} [p.providerError]  why `llm` is null, when it is
 * @param {string | null} [p.system]         IA's charter, if available
 * @param {number} [p.maxTokens]
 * @returns {Promise<{ outcome: 'written'|'rejected'|'call_failed'|'no_provider'|'unrecorded', detail: string, row?: object }>}
 */
export async function writeAuditReport({ db, llm, auditId, providerError = null, system = null, maxTokens = 1200 }) {
  // 1. READ THE ROW BACK. This is the step that makes the ordering structural
  //    on the runner's side: the model's input is whatever is committed.
  const { data: row, error: readErr } = await db
    .from("agent_audits")
    .select("id, agent_name, run_at, findings, severity, report, report_error")
    .eq("id", auditId)
    .single();
  if (readErr || !row) {
    // Nothing can be recorded on a row that cannot be read. The findings row,
    // if it exists, is untouched.
    return { outcome: "unrecorded", detail: `could not read audit ${auditId} back: ${readErr?.message ?? "not found"}` };
  }
  if (row.report !== null || row.report_error !== null) {
    return { outcome: "unrecorded", detail: `audit ${auditId} already has a report outcome; 0013 makes it write-once` };
  }

  // 2. ASK. Every way this can fail becomes a recorded reason.
  let outcome;
  let detail;
  let update;
  if (!llm) {
    outcome = "no_provider";
    detail = `no model provider: ${providerError ?? "none configured"}`;
    update = { report_error: detail };
  } else {
    let raw = null;
    let callErr = null;
    try {
      ({ text: raw } = await llm.complete(
        [{ role: "user", content: reportPrompt(row) }],
        { system: system ?? DEFAULT_SYSTEM, maxTokens },
      ));
    } catch (err) {
      callErr = err;
    }
    if (callErr) {
      outcome = "call_failed";
      detail = `model call failed (${llm.describe()}): ${String(callErr.message ?? callErr).slice(0, 500)}`;
      update = { report_error: detail };
    } else {
      const parsed = parseReport(raw);
      if (parsed.ok) {
        outcome = "written";
        detail = `${parsed.report.length} chars`;
        update = { report: parsed.report };
      } else {
        outcome = "rejected";
        detail = `model output rejected (${llm.describe()}): ${parsed.reason}`;
        update = { report_error: detail };
      }
    }
  }

  // 3. RECORD. Only `report` or `report_error` is sent — report_at is the
  //    database's to stamp (0013). `.is(..., null)` makes a concurrent writer
  //    lose cleanly instead of racing the write-once trigger.
  const { data: after, error: writeErr } = await db
    .from("agent_audits")
    .update(update)
    .eq("id", auditId)
    .is("report", null)
    .is("report_error", null)
    .select("id, severity, report, report_at, report_error")
    .maybeSingle();
  if (writeErr || !after) {
    return {
      outcome: "unrecorded",
      detail: `${detail} — and the outcome could not be recorded: ${writeErr?.message ?? "row changed underneath"}`,
    };
  }
  return { outcome, detail, row: after };
}
