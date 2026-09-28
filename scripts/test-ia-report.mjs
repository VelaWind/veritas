#!/usr/bin/env node
/**
 * Unit tests for `parseReport` and `reportPrompt` — the IA report stage (§D.4).
 *
 *   npm run test:unit
 *
 * WHY THIS EXISTS: parseReport is the line between "the model wrote a report"
 * and "the model returned something, and we stored it as one". If it accepts too
 * much, empty or reasoning-only output lands in `report` and reads as the
 * auditor's commentary. If it accepts too little, every report becomes a NULL
 * with a report_error and nobody notices, because a NULL report is a complete
 * audit and does not fail the run. Both directions are asserted: rejection
 * cases AND the acceptance case, so a parser that refused everything could not
 * pass this file.
 *
 * verify-agents covers the same rules end-to-end through a stub model and the
 * live table; this file covers them with no database and no model, so the rules
 * themselves are pinned even when the harness cannot run.
 *
 * No framework, no dependency, plain node — same style as test-sanitize.mjs.
 */
import {
  REPORT_MAX_CHARS,
  REPORT_MIN_CHARS,
  parseReport,
  reportPrompt,
} from "./agent-lib/ia-report.mjs";

let pass = 0;
let fail = 0;
const failures = [];

function check(label, ok, detail = "") {
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    failures.push(label);
    console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ""}`);
  }
}

const PROSE =
  "Check #1 ran and found no unresolved citations. Check #2 did not run: this agent " +
  "has no declared domain. The remaining checks ran and graded ok.";

console.log("── parseReport: the permitted case ──");
{
  const r = parseReport(PROSE);
  check("ordinary prose is accepted verbatim", r.ok && r.report === PROSE, JSON.stringify(r));
}
{
  const r = parseReport(`<think>Let me weigh the findings…</think>\n\n${PROSE}`);
  check("a leading reasoning block is stripped and the prose kept", r.ok && r.report === PROSE, JSON.stringify(r));
}
{
  const long = "a".repeat(REPORT_MAX_CHARS + 500);
  const r = parseReport(long);
  check(
    "an over-long report is kept but truncated, and says so in its own text",
    r.ok && r.report.startsWith("a".repeat(REPORT_MAX_CHARS)) && /truncated at \d+ characters/.test(r.report),
    r.ok ? r.report.slice(-80) : r.reason,
  );
}

console.log("\n── parseReport: what is not a report ──");
for (const [label, input, pattern] of [
  ["empty string", "", /empty output/],
  ["whitespace only", "   \n\t  ", /empty output/],
  ["null", null, /null, not text/],
  ["undefined", undefined, /undefined, not text/],
  ["a number", 42, /number, not text/],
  ["a closed reasoning block and nothing else", "<think>the findings say…</think>", /only a reasoning block/],
  ["an UNCLOSED reasoning block (cut off by max_tokens)", "<think>first, check #1 shows", /only a reasoning block/],
  ["a fragment under the floor", "All fine.", new RegExp(`minimum ${REPORT_MIN_CHARS}`)],
  ["control-character garbage", "\u0001\u0002\u0003".repeat(40), /not readable text/],
]) {
  const r = parseReport(input);
  check(`${label} → rejected with a reason that says which`, !r.ok && pattern.test(r.reason ?? ""), JSON.stringify(r));
}

console.log("\n── reportPrompt: built from the stored row ──");
{
  const row = {
    id: "00000000-0000-4000-8000-000000000001",
    agent_name: "physics-researcher",
    run_at: "2026-09-28T00:00:00Z",
    severity: "concern",
    findings: [{ check: 4, key: "duplicate_resubmission", severity: "concern", status: "ran", duplicates: 1 }],
  };
  const p = reportPrompt(row);
  check("names the audit id it was built from", p.includes(row.id));
  check("carries the stored findings verbatim", p.includes(JSON.stringify(row.findings, null, 2)));
  check("states the derived severity as fixed, not as a question", /severity is concern/.test(p) && /nothing you write can change it/.test(p));
  check("tells the model a non-\"ran\" check did not run", /DID NOT RUN/.test(p));
  check("forbids announcing a sanction", /Do not recommend or announce a sanction/.test(p));
}

console.log(
  `\n${fail === 0 ? "ALL GREEN" : `${fail} FAILURE(S)`} — ${pass} passed, ${fail} failed`,
);
if (fail > 0) {
  console.log("\nFailed:");
  for (const f of failures) console.log(`  · ${f}`);
}
process.exitCode = fail === 0 ? 0 : 1;
