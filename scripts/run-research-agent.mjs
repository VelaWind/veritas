// ─────────────────────────────────────────────────────────────────────────────
// Research Agent (DECISIONS §B.5) — ON-DEMAND, BOUNDED, PROPOSE-ONLY.
//
// Given a question or a domain, it reads the existing public map for grounding,
// asks the configured model to draft hypotheses (with assumptions, falsification
// criteria, and supporting/contesting evidence), and PROPOSES each into the
// suggestion queue as a `pending` agent suggestion. It writes nothing to the
// live map — a human admin approves every proposal. It does ONE bounded unit of
// work, respecting per-run caps, then stops. No loop, no cron.
//
// Usage:
//   node scripts/run-research-agent.mjs --question <slug | "free text"> [--domain <slug>]
//   node scripts/run-research-agent.mjs --domain <slug>
//   [--max-proposals N] [--max-model-calls N] [--max-output-tokens N]
//   [--base-url http://localhost:3000] [--dry-run]
//
// Env: VERITAS_AGENT_TOKEN (scoped token from mint-agent-token.mjs),
//      NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY (public reads), and the
//      VERITAS_LLM_* provider config (defaults to local Ollama, $0/call).
// ─────────────────────────────────────────────────────────────────────────────
import { loadEnv, requireEnv } from "./agent-lib/env.mjs";
import { parseArgs, intArg } from "./agent-lib/args.mjs";
import { createLlmProvider } from "./agent-lib/llm.mjs";
import { capsFromArgs } from "./agent-lib/caps.mjs";
import { makeAnonClient, propose } from "./agent-lib/agent-client.mjs";
import { clampConfidence, normalizeStatus } from "./agent-lib/epistemics.mjs";
import { slugify, uniquify, extractJson, titleKey } from "./agent-lib/util.mjs";

loadEnv();
const args = parseArgs();
const DRY = Boolean(args["dry-run"]);
const BASE = args["base-url"] || process.env.BASE_URL || "http://localhost:3000";

if (!args.question && !args.domain) {
  console.error('Provide --question <slug | "text"> and/or --domain <slug>.');
  process.exit(2);
}

const URL_ = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const ANON = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const TOKEN = process.env.VERITAS_AGENT_TOKEN;
if (!TOKEN && !DRY) {
  console.error("Missing VERITAS_AGENT_TOKEN. Mint one with scripts/mint-agent-token.mjs, or use --dry-run.");
  process.exit(2);
}

const llm = createLlmProvider();
const caps = capsFromArgs(args);
const wantHypotheses = intArg(args.count, caps.maxProposals);

const anon = await makeAnonClient(URL_, ANON);

// ── Resolve the research target (a domain is always required for a hypothesis) ─
let domain = null;
let question = null;

if (args.question && args.question !== true) {
  const { data: q } = await anon
    .from("questions")
    .select("id, slug, title, description, domain:domains(id, slug, name, overview)")
    .eq("slug", String(args.question))
    .maybeSingle();
  if (q) {
    question = q;
    domain = Array.isArray(q.domain) ? q.domain[0] : q.domain;
  }
}

if (!domain && args.domain && args.domain !== true) {
  const { data: d } = await anon
    .from("domains")
    .select("id, slug, name, overview")
    .eq("slug", String(args.domain))
    .maybeSingle();
  domain = d ?? null;
}

if (!domain) {
  console.error(
    args.question && !question
      ? `No question with slug "${args.question}". For a free-text question, also pass --domain <slug>.`
      : `Could not resolve a domain. Pass --domain <slug> (or a --question whose slug exists).`,
  );
  process.exit(2);
}

const topic =
  question?.title ||
  (args.question && args.question !== true ? String(args.question) : null) ||
  `Open problems in ${domain.name}`;

// ── Ground the model: what already exists in this domain (avoid duplicates) ────
const { data: existing } = await anon
  .from("hypotheses")
  .select("title, slug, status")
  .eq("domain_id", domain.id)
  .limit(50);
const existingList = existing ?? [];
const takenSlugs = new Set(existingList.map((h) => h.slug));
const seenTitles = new Set(existingList.map((h) => titleKey(h.title)));

console.log(`\nResearch Agent — ${DRY ? "DRY RUN (no writes)" : "proposing into the queue"}`);
console.log(`  model    : ${llm.describe()}`);
console.log(`  target   : ${topic}`);
console.log(`  domain   : ${domain.name} (${domain.slug})`);
console.log(`  caps     : ${caps.summary()}`);
console.log(`  existing : ${existingList.length} hypotheses in this domain\n`);

const SYSTEM = `You are a research agent for Veritas, an observatory of human knowledge.
You PROPOSE hypotheses for HUMAN REVIEW — you never assert as settled. Be calibrated and intellectually humble: most genuinely open research questions sit at 'plausible' or 'speculation'. Ground every claim in mainstream scholarship.

Epistemic rules (HARD constraints):
- status is one of: established, strong_evidence, plausible, speculation, unknown.
- confidence is an integer 0–100 and MUST lie inside the band for the status:
    established 81–100 · strong_evidence 61–80 · plausible 21–60 · speculation 0–40 · unknown 0–20.
- A hypothesis MUST have: a falsifiable description, at least one explicit assumption, and falsification_criteria.

Output STRICT JSON ONLY — no prose, no markdown fences — with exactly this shape:
{
  "title": "concise claim (3–300 chars)",
  "slug": "kebab-case-slug",
  "description": "the hypothesis and its reasoning (markdown ok)",
  "status": "plausible",
  "confidence": 40,
  "confidence_rationale": "why this confidence level",
  "assumptions": [{"text": "an assumption", "justified": true}],
  "open_questions": [{"text": "what remains unresolved"}],
  "falsification_criteria": "an observation that would refute this",
  "reviewer_note": "one-line note to the human reviewer",
  "evidence": [
    {"title": "evidence title", "slug": "evidence-slug", "summary": "what it shows",
     "strength": 60, "relation": "supports", "citation": "author, work, year (or URL)"}
  ]
}`;

// One submit path for DRY and real, so the proposal cap is honored identically
// in preview and in a real run. Returns {status, capped?, data?, error?}.
async function submit(envelope) {
  if (!caps.canPropose()) return { status: 0, capped: true };
  if (DRY) return { status: 201, data: { id: "(dry-run)" } };
  return propose(BASE, TOKEN, envelope);
}

const proposedTitles = [];
const results = { hypotheses: 0, evidence: 0, skipped: 0 };

for (let i = 0; i < wantHypotheses; i++) {
  if (!caps.canCallModel()) break;
  if (!caps.canPropose()) break;

  const avoid = [...existingList.map((h) => h.title), ...proposedTitles];
  const user = `Research target: ${topic}
Domain: ${domain.name} — ${domain.overview || "(no overview)"}
${question?.description ? `Question detail: ${question.description}\n` : ""}
Already on the map or proposed this run (do NOT repeat or trivially rephrase):
${avoid.length ? avoid.map((t) => `- ${t}`).join("\n") : "- (none yet)"}

Draft ONE NEW, distinct hypothesis (#${i + 1}) on this target, with 1–2 pieces of evidence. JSON only.`;

  let resp;
  try {
    resp = await llm.complete([{ role: "user", content: user }], {
      system: SYSTEM,
      maxTokens: intArg(process.env.VERITAS_LLM_MAX_TOKENS, 1500),
    });
  } catch (err) {
    console.log(`  ✗ model call failed: ${err.message}`);
    break;
  }
  caps.recordCall(resp.usage);

  const obj = extractJson(resp.text);
  if (!obj || !obj.title || !obj.description) {
    console.log(`  · #${i + 1}: unparseable / incomplete model output — skipping`);
    results.skipped++;
    continue;
  }

  // Dedupe by title fingerprint.
  const key = titleKey(obj.title);
  if (seenTitles.has(key)) {
    console.log(`  · #${i + 1}: "${obj.title}" duplicates existing work — skipping`);
    results.skipped++;
    continue;
  }
  seenTitles.add(key);

  // Repair to satisfy the epistemic guard + schema before proposing.
  const status = normalizeStatus(obj.status);
  const confidence = clampConfidence(status, Number(obj.confidence));
  const slug = uniquify(slugify(obj.slug || obj.title), takenSlugs);
  const assumptions =
    Array.isArray(obj.assumptions) && obj.assumptions.length
      ? obj.assumptions.map((a) => ({
          text: String(a?.text ?? a ?? "").slice(0, 1000) || "Stated assumption.",
          justified: Boolean(a?.justified),
          ...(a?.notes ? { notes: String(a.notes) } : {}),
        }))
      : [{ text: "Drafted by the research agent; assumptions to be reviewed.", justified: false }];
  const openQuestions = Array.isArray(obj.open_questions)
    ? obj.open_questions
        .map((o) => ({ text: String(o?.text ?? o ?? "").slice(0, 1000) }))
        .filter((o) => o.text)
    : [];

  const reviewerNote =
    (obj.reviewer_note && String(obj.reviewer_note).trim()) ||
    `Research agent draft on "${topic}".`;

  const hypPayload = {
    slug,
    domain_id: domain.id,
    question_id: question?.id ?? null,
    title: String(obj.title).slice(0, 300),
    description: String(obj.description),
    status,
    state: "draft", // proposals enter as drafts; an admin promotes on approval
    confidence,
    confidence_rationale: String(obj.confidence_rationale || "").slice(0, 4000),
    assumptions,
    open_questions: openQuestions,
    falsification_criteria: String(obj.falsification_criteria || ""),
  };

  console.log(`  → #${i + 1} ${status} ${confidence}%  "${hypPayload.title}"`);

  const res = await submit({
    target_type: "hypothesis",
    operation: "create",
    payload: hypPayload,
    rationale: reviewerNote,
  });
  if (res.capped) break;
  if (res.status === 201) {
    caps.recordProposal();
    results.hypotheses++;
    proposedTitles.push(obj.title);
  } else if (res.status === 429) {
    console.log(`    ✗ server cap hit (429): ${res.error}`);
    caps.stoppedReason ??= "server queue cap (429)";
    break;
  } else {
    console.log(`    ✗ proposal rejected (${res.status}): ${res.error}`);
    results.skipped++;
    continue; // do not attach evidence to a hypothesis that didn't land
  }

  // Evidence proposals (independent queue rows; the admin links them on approval,
  // guided by the relation + target named in the rationale).
  const evidence = Array.isArray(obj.evidence) ? obj.evidence.slice(0, 2) : [];
  for (const ev of evidence) {
    if (!ev || !ev.title || !ev.summary) continue;
    const evSlug = uniquify(slugify(ev.slug || ev.title, "agent-evidence"), takenSlugs);
    const citation = String(ev.citation || "").trim();
    const isUrl = /^https?:\/\//i.test(citation);
    const evRes = await submit({
      target_type: "evidence",
      operation: "create",
      payload: {
        slug: evSlug,
        title: String(ev.title).slice(0, 300),
        summary: String(ev.summary),
        strength: clampStrength(ev.strength),
        domain_id: domain.id,
        new_source: {
          title: citation || `Source for "${ev.title}"`.slice(0, 400),
          url: isUrl ? citation : null,
          source_type: "other",
          reliability: 50,
        },
      },
      rationale: `${ev.relation || "supports"} "${hypPayload.title}". ${citation ? `Citation: ${citation}.` : ""} Link on approval.`,
    });
    if (evRes.capped) break;
    if (evRes.status === 201) {
      caps.recordProposal();
      results.evidence++;
    } else if (evRes.status === 429) {
      caps.stoppedReason ??= "server queue cap (429)";
      break;
    }
  }
}

function clampStrength(v) {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) return 50;
  return Math.min(100, Math.max(0, n));
}

console.log(`\nDone — ${results.hypotheses} hypothesis + ${results.evidence} evidence proposal(s)` +
  `${results.skipped ? `, ${results.skipped} skipped` : ""}.`);
console.log(`  caps: ${caps.summary()}`);
if (caps.stoppedReason) console.log(`  stopped early: ${caps.stoppedReason}`);
if (!DRY && results.hypotheses + results.evidence > 0) {
  console.log(`\nReview them in the admin queue: ${BASE.replace(/\/$/, "")}/admin/suggestions  (status: pending)`);
} else if (DRY) {
  console.log(`\n(dry run — nothing was written to the queue)`);
}
