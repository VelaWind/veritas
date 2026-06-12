// ─────────────────────────────────────────────────────────────────────────────
// Contradiction Agent (DECISIONS §B.5) — ON-DEMAND, BOUNDED, PROPOSE-ONLY.
//
// Scans existing public hypotheses for SEMANTIC / assumption-level tension that
// the mechanical scan_contradictions() can't catch, and proposes each finding
// for ADMIN CONFIRMATION. It does NOT write to the `contradictions` table (that
// stays admin + the security-definer scan).
//
// Schema note (deliberate, documented in DECISIONS §B impl): the Phase A queue's
// target_type is hypothesis|evidence only — 'contradiction' is not a suggestable
// type. So a finding is surfaced as a reviewable hypothesis EDIT on the more
// contestable hypothesis of the pair: it records the tension as an open_question
// and carries the full A↔B explanation in the suggestion rationale. An admin
// reviews, and — if confirmed — records the formal contradiction. Nothing
// changes on the live map without that human approval.
//
// Usage:
//   node scripts/run-contradiction-agent.mjs [--domain <slug>]
//     [--max-proposals N] [--max-model-calls N] [--max-pairs N]
//     [--base-url http://localhost:3000] [--dry-run]
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync } from "node:fs";
import { loadEnv, requireEnv } from "./agent-lib/env.mjs";
import { parseArgs, intArg } from "./agent-lib/args.mjs";
import { createLlmProvider } from "./agent-lib/llm.mjs";
import { capsFromArgs } from "./agent-lib/caps.mjs";
import { makeAnonClient, propose } from "./agent-lib/agent-client.mjs";
import { extractJson } from "./agent-lib/util.mjs";

loadEnv();
const args = parseArgs();
const DRY = Boolean(args["dry-run"]);
const BASE = args["base-url"] || process.env.BASE_URL || "http://localhost:3000";

const URL_ = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const ANON = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const TOKEN = process.env.VERITAS_AGENT_TOKEN;
if (!TOKEN && !DRY) {
  console.error("Missing VERITAS_AGENT_TOKEN. Mint one with scripts/mint-agent-token.mjs, or use --dry-run.");
  process.exit(2);
}

const llm = createLlmProvider();
const caps = capsFromArgs(args);
const maxPairs = intArg(args["max-pairs"], 30);
const anon = await makeAnonClient(URL_, ANON);

// ── Read the public hypotheses to scan (RLS hides drafts) ─────────────────────
let q = anon
  .from("hypotheses")
  .select("id, slug, title, description, status, confidence, open_questions, domain_id, domain:domains(slug, name)")
  .neq("state", "draft")
  .order("confidence", { ascending: true })
  .limit(maxPairs);

let domainName = "all domains";
if (args.domain && args.domain !== true) {
  const { data: d } = await anon.from("domains").select("id, name").eq("slug", String(args.domain)).maybeSingle();
  if (!d) {
    console.error(`No domain with slug "${args.domain}".`);
    process.exit(2);
  }
  q = q.eq("domain_id", d.id);
  domainName = d.name;
}

const { data: hyps } = await q;
const list = hyps ?? [];

console.log(`\nContradiction Agent — ${DRY ? "DRY RUN (no writes)" : "proposing into the queue"}`);
console.log(`  model    : ${llm.describe()}`);
console.log(`  scope    : ${domainName}`);
console.log(`  caps     : ${caps.summary()}`);
console.log(`  scanning : ${list.length} hypotheses\n`);

if (list.length < 2) {
  console.log("Need at least 2 published hypotheses to find tension. Nothing to do.");
  process.exit(0);
}

const SYSTEM = `You are a contradiction-detection agent for Veritas. You find SEMANTIC or ASSUMPTION-LEVEL tension between hypotheses that a purely mechanical scan would miss — two claims that cannot both be fully true, rest on incompatible assumptions, or are pulled apart by the same evidence. You PROPOSE findings for human review; you never assert a contradiction as fact. Be precise and conservative: only report genuine tension, not mere topical similarity.

You are given a numbered list of hypotheses. Output STRICT JSON ONLY — no prose, no fences:
{
  "findings": [
    {
      "a": 0,                       // index of the first hypothesis
      "b": 3,                       // index of the second
      "kind": "logical",            // logical | evidential | assumption
      "explanation": "why these are in tension (1–3 sentences)",
      "more_contestable": "a"       // which one is weaker / should carry the open question: "a" or "b"
    }
  ]
}
Return an empty findings array if there is no genuine contradiction.`;

const lines = list
  .map((h, i) => `[${i}] (${h.status} ${h.confidence}%) ${h.title} — ${oneLine(h.description)}`)
  .join("\n");

function oneLine(s) {
  return String(s || "").replace(/\s+/g, " ").trim().slice(0, 240);
}

const findings = [];
const passes = intArg(args.passes, 1);
for (let p = 0; p < passes; p++) {
  if (!caps.canCallModel()) break;
  let resp;
  try {
    resp = await llm.complete(
      [{ role: "user", content: `Hypotheses:\n${lines}\n\nFind genuine contradictions. JSON only.` }],
      { system: SYSTEM, maxTokens: intArg(process.env.VERITAS_LLM_MAX_TOKENS, 1500) },
    );
  } catch (err) {
    console.log(`  ✗ model call failed: ${err.message}`);
    break;
  }
  caps.recordCall(resp.usage);
  const obj = extractJson(resp.text);
  if (obj && Array.isArray(obj.findings)) findings.push(...obj.findings);
}

// ── Propose each finding as a hypothesis-edit suggestion ──────────────────────
// One submit path for DRY and real, so the proposal cap is honored identically.
async function submit(envelope) {
  if (!caps.canPropose()) return { status: 0, capped: true };
  if (DRY) return { status: 201, data: { id: "(dry-run)" } };
  return propose(BASE, TOKEN, envelope);
}

const seenPairs = new Set();
const results = { proposed: 0, skipped: 0 };
const collected = [];

for (const f of findings) {
  if (!caps.canPropose()) break;
  const a = list[Number(f?.a)];
  const b = list[Number(f?.b)];
  if (!a || !b || a.id === b.id) {
    results.skipped++;
    continue;
  }
  const pairKey = [a.id, b.id].sort().join("|");
  if (seenPairs.has(pairKey)) {
    results.skipped++;
    continue;
  }
  seenPairs.add(pairKey);

  // Record the tension on the more contestable hypothesis (default: lower
  // confidence). Include its domain_id so a domain-scoped agent passes the
  // server scope check (the value is the target's own domain → no real change).
  const target = f?.more_contestable === "b" ? b : a.confidence <= b.confidence ? a : b;
  const other = target.id === a.id ? b : a;
  const kind = ["logical", "evidential", "assumption"].includes(f?.kind) ? f.kind : "logical";
  const explanation = oneLine(f?.explanation) || "Potential tension flagged for review.";

  const existingOQ = Array.isArray(target.open_questions)
    ? target.open_questions.map((o) => ({ text: String(o?.text ?? "").slice(0, 1000) })).filter((o) => o.text)
    : [];
  const noteText = `Possible ${kind} contradiction with "${other.title}": ${explanation}`;
  if (existingOQ.some((o) => o.text.includes(other.title))) {
    results.skipped++; // tension with this partner already recorded
    continue;
  }

  console.log(`  → ${kind}: "${target.title}"  ⟷  "${other.title}"`);

  const res = await submit({
    target_type: "hypothesis",
    operation: "edit",
    target_id: target.id,
    payload: {
      domain_id: target.domain_id,
      open_questions: [...existingOQ, { text: noteText.slice(0, 1000) }],
    },
    rationale:
      `Contradiction finding (${kind}) between "${a.title}" and "${b.title}": ${explanation} ` +
      `Proposed by the contradiction agent for admin confirmation — if real, record the formal contradiction.`,
  });
  if (res.capped) break;
  if (res.status === 201) {
    caps.recordProposal();
    results.proposed++;
    collected.push({
      kind,
      target_title: target.title,
      other_title: other.title,
      target_status: `${target.status} ${target.confidence}%`,
      other_status: `${other.status} ${other.confidence}%`,
      explanation,
      note: noteText,
    });
  } else if (res.status === 429) {
    console.log(`    ✗ server cap hit (429): ${res.error}`);
    caps.stoppedReason ??= "server queue cap (429)";
    break;
  } else {
    console.log(`    ✗ proposal rejected (${res.status}): ${res.error}`);
    results.skipped++;
  }
}

if (args.out && args.out !== true) {
  writeFileSync(
    String(args.out),
    JSON.stringify(
      {
        agent: "contradiction",
        dry_run: DRY,
        model: llm.describe(),
        scope: domainName,
        caps: caps.summary(),
        stopped_early: caps.stoppedReason ?? null,
        findings: collected,
      },
      null,
      2,
    ),
  );
  console.log(`  wrote ${collected.length} finding record(s) → ${args.out}`);
}

console.log(`\nDone — ${results.proposed} contradiction finding(s) proposed` +
  `${results.skipped ? `, ${results.skipped} skipped` : ""}.`);
console.log(`  caps: ${caps.summary()}`);
if (caps.stoppedReason) console.log(`  stopped early: ${caps.stoppedReason}`);
if (!DRY && results.proposed > 0) {
  console.log(`\nReview them in the admin queue: ${BASE.replace(/\/$/, "")}/admin/suggestions  (status: pending)`);
} else if (DRY) {
  console.log(`\n(dry run — nothing was written to the queue)`);
}
