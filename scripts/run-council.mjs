// ─────────────────────────────────────────────────────────────────────────────
// Council runner (DECISIONS §D.3) — ON-DEMAND, BOUNDED, PUBLIC.
//
// Four roles (advocate → skeptic → verifier → synthesizer) argue one claim over
// N rounds, and every turn is written to `council_turns` as it happens. The
// transcript is the product: it is public, and it is the artifact the eventual
// verdict must be traceable to.
//
// WHAT THIS SCRIPT DOES NOT DO, DELIBERATELY: it does not propose anything. The
// verdict is written to `councils.verdict` / `.outcome` / `.vote` and stops
// there. Wiring it to /api/agent/suggestions is a separate step, held back on
// purpose so the transcript is working before anything reaches the queue.
// `councils.suggestion_id` therefore stays null, and no council here needs the
// `council` agent identity or a token.
//
// TRUST BOUNDARY — read before extending. `councils` and `council_turns` are
// admin-write under RLS (0010), so this runner writes with the SERVICE ROLE, the
// same boundary as scripts/seed-agent-roster.mjs. That is a wider credential
// than the research runner holds, and it is why the read half is deliberately
// NOT service-role: grounding material is read with the ANON key, so the council
// argues from exactly what a visitor can see, and a draft hypothesis cannot leak
// into a public transcript. When the verdict is eventually wired to the queue it
// must go through the propose ROUTE with the scoped `council` token — the part
// that touches suggestions gets least privilege, not this.
//
// Usage:
//   node scripts/run-council.mjs --hypothesis <slug> [--rounds 2]
//   node scripts/run-council.mjs --question <slug>   [--rounds 2]
//     [--context-budget 6000] [--max-turn-tokens 400]
//     [--max-model-calls N] [--dry-run]
// ─────────────────────────────────────────────────────────────────────────────
import { loadEnv, requireEnv } from "./agent-lib/env.mjs";
import { parseArgs, intArg } from "./agent-lib/args.mjs";
import { createLlmProvider } from "./agent-lib/llm.mjs";
import { capsFromArgs } from "./agent-lib/caps.mjs";
import { makeAnonClient } from "./agent-lib/agent-client.mjs";
import { extractJson } from "./agent-lib/util.mjs";
import {
  COUNCIL_ROLES,
  DEFAULT_CONTEXT_BUDGET_TOKENS,
  DEFAULT_MAX_TURN_TOKENS,
  ROLE_SYSTEM,
  SYNTHESIS_SYSTEM,
  buildTranscriptContext,
  turnPrompt,
  validateSynthesis,
} from "./agent-lib/council.mjs";

/**
 * Running out of budget is NOT an error condition — §D.3 lists "ran out of
 * rounds or budget" as `no_verdict` on a COMPLETE council. It travels as a
 * distinct exception type only so the catch can tell it apart from a genuine
 * failure, which aborts.
 */
class CapsExhausted extends Error {
  constructor(message) {
    super(message ?? "run caps reached");
    this.name = "CapsExhausted";
  }
}

loadEnv();
const args = parseArgs();
const DRY = Boolean(args["dry-run"]);
const rounds = Math.max(1, intArg(args.rounds, 2));
const contextBudget = intArg(args["context-budget"], DEFAULT_CONTEXT_BUDGET_TOKENS);
const maxTurnTokens = intArg(args["max-turn-tokens"], DEFAULT_MAX_TURN_TOKENS);

const URL_ = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const ANON = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

const hypSlug = typeof args.hypothesis === "string" ? args.hypothesis : null;
const qSlug = typeof args.question === "string" ? args.question : null;
if (!hypSlug && !qSlug) {
  console.error("Give a subject: --hypothesis <slug> or --question <slug>.");
  process.exit(2);
}
if (hypSlug && qSlug) {
  console.error("Give ONE subject, not both.");
  process.exit(2);
}

const llm = createLlmProvider();
const caps = capsFromArgs(args);
const anon = await makeAnonClient(URL_, ANON);

// ── Service client, for the council tables only ───────────────────────────────
let service = null;
if (!DRY) {
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const { createClient } = await import("@supabase/supabase-js");
  service = createClient(URL_, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// ── Subject (read as anon: the council argues from the public record) ─────────
async function loadSubject() {
  if (hypSlug) {
    const { data, error } = await anon
      .from("hypotheses")
      .select(
        "id, slug, title, description, status, confidence, confidence_rationale, " +
          "assumptions, falsification_criteria, domain:domains(slug, name)",
      )
      .eq("slug", hypSlug)
      .maybeSingle();
    if (error) throw new Error(`read hypothesis: ${error.message}`);
    if (!data) throw new Error(`No public hypothesis with slug "${hypSlug}".`);

    const { data: links } = await anon
      .from("hypothesis_evidence")
      .select("relation, weight, evidence:evidence(title, summary, slug)")
      .eq("hypothesis_id", data.id);

    const evidence = (links ?? [])
      .map((l) => `- [${l.relation}, weight ${l.weight}] ${l.evidence?.title ?? "?"}: ${l.evidence?.summary ?? ""}`)
      .join("\n");

    const text = [
      `HYPOTHESIS: ${data.title}`,
      `Domain: ${data.domain?.name ?? "—"}`,
      `Current standing: ${data.status} at confidence ${data.confidence}/100`,
      `Why that confidence: ${data.confidence_rationale || "(not stated)"}`,
      ``,
      `DESCRIPTION:\n${data.description}`,
      ``,
      `STATED ASSUMPTIONS: ${JSON.stringify(data.assumptions ?? [])}`,
      `FALSIFICATION CRITERIA: ${data.falsification_criteria || "(none stated)"}`,
      ``,
      `EVIDENCE ON RECORD:\n${evidence || "(none linked)"}`,
    ].join("\n");

    return { type: "hypothesis", id: data.id, slug: data.slug, title: data.title, text };
  }

  const { data, error } = await anon
    .from("questions")
    .select("id, slug, title, description, status, current_explanations, domain:domains(slug, name)")
    .eq("slug", qSlug)
    .maybeSingle();
  if (error) throw new Error(`read question: ${error.message}`);
  if (!data) throw new Error(`No public question with slug "${qSlug}".`);

  const { data: hyps } = await anon
    .from("hypotheses")
    .select("slug, title, status, confidence")
    .eq("question_id", data.id)
    .neq("state", "draft")
    .order("confidence", { ascending: false });

  const competing = (hyps ?? [])
    .map((h) => `- ${h.title} — ${h.status} at ${h.confidence}/100 (${h.slug})`)
    .join("\n");

  const text = [
    `OPEN QUESTION: ${data.title}`,
    `Domain: ${data.domain?.name ?? "—"}`,
    `Standing: ${data.status}`,
    ``,
    `DESCRIPTION:\n${data.description}`,
    ``,
    `CURRENT EXPLANATIONS:\n${data.current_explanations || "(none recorded)"}`,
    ``,
    `COMPETING HYPOTHESES ON RECORD:\n${competing || "(none)"}`,
  ].join("\n");

  return { type: "question", id: data.id, slug: data.slug, title: data.title, text };
}

const subject = await loadSubject();

console.log(`\nCouncil — ${DRY ? "DRY RUN (no writes)" : "writing a public transcript"}`);
console.log(`  model    : ${llm.describe()}`);
console.log(`  subject  : ${subject.type} "${subject.slug}"`);
console.log(`  rounds   : ${rounds}  (${rounds * COUNCIL_ROLES.length + 1} model calls at full length)`);
console.log(`  budget   : ${contextBudget} est. tokens of transcript · ${maxTurnTokens} tokens per turn`);
console.log(`  caps     : ${caps.summary()}\n`);

// ── The council row, opened `running` ─────────────────────────────────────────
let councilId = null;
if (!DRY) {
  const { data, error } = await service
    .from("councils")
    .insert({
      subject_type: subject.type,
      subject_id: subject.id,
      subject_slug: subject.slug,
      subject_title: subject.title,
      status: "running",
      model: `${llm.provider}:${llm.model}`,
    })
    .select("id")
    .single();
  if (error) throw new Error(`open council: ${error.message}`);
  councilId = data.id;
  console.log(`  council  : ${councilId}\n`);
}

// ── Abort is a state, not a silent exit ───────────────────────────────────────
// The councils_abort_has_reason CHECK refuses an `aborted` row with an empty
// reason, so every path that gives up has to say why. A runner that simply died
// would leave a `running` row forever — that is what this handles. What it
// cannot handle is a hard kill (SIGKILL, power loss), where no code runs at all;
// a stale `running` council is that case, and it is a real limitation rather
// than one this function papers over.
let finished = false;
async function abort(reason) {
  if (finished || DRY || !councilId) return;
  finished = true;
  const text = String(reason ?? "").trim() || "aborted for an unrecorded reason";
  const { error } = await service
    .from("councils")
    .update({ status: "aborted", abort_reason: text.slice(0, 2000), completed_at: new Date().toISOString() })
    .eq("id", councilId);
  if (error) console.error(`  ! could not record the abort: ${error.message}`);
  else console.log(`\n  ABORTED — ${text}`);
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    await abort(`interrupted by ${sig}`);
    process.exit(130);
  });
}

// ── The debate ────────────────────────────────────────────────────────────────
const turns = [];          // in-memory mirror of council_turns, for the budget
let roundsRun = 0;

async function runTurn(round, seq, role) {
  const ctx = buildTranscriptContext(turns, contextBudget);
  const user = turnPrompt({
    subject: subject.text,
    transcript: ctx.text,
    round,
    totalRounds: rounds,
    role,
  });

  const resp = await llm.complete([{ role: "user", content: user }], {
    system: ROLE_SYSTEM[role],
    maxTokens: maxTurnTokens,
  });
  caps.recordCall(resp.usage);

  // A role that returns unparseable JSON has still SPOKEN — its raw text is the
  // turn. Dropping it would silently shorten the debate and leave a gap in a
  // public transcript with no indication that anything was lost.
  const obj = extractJson(resp.text);
  const content = String(obj?.content ?? resp.text ?? "").trim().slice(0, 8000);
  const reasoning = String(obj?.reasoning ?? "").trim().slice(0, 8000);

  const turn = {
    council_id: councilId,
    round,
    seq,
    role,
    agent_name: role,
    content,
    reasoning,
    context_truncated: ctx.truncated,
  };

  if (!DRY) {
    const { error } = await service.from("council_turns").insert(turn);
    if (error) throw new Error(`write turn r${round}s${seq} (${role}): ${error.message}`);
  }
  turns.push(turn);

  console.log(
    `  r${round} ${role.padEnd(12)} ${String(resp.usage?.output_tokens ?? 0).padStart(4)} tok out · ` +
      `context ${ctx.included}/${ctx.included + ctx.omitted} turns (~${ctx.tokens} tok)` +
      (ctx.truncated ? `  ⟨TRUNCATED, ${ctx.omitted} dropped⟩` : ""),
  );
  return turn;
}

try {
  for (let round = 1; round <= rounds; round++) {
    for (let i = 0; i < COUNCIL_ROLES.length; i++) {
      if (!caps.canCallModel()) throw new CapsExhausted(caps.stoppedReason);
      await runTurn(round, i + 1, COUNCIL_ROLES[i]);
    }
    roundsRun = round;
  }

  // ── Final synthesis: the verdict, the vote, the outcome ────────────────────
  if (!caps.canCallModel()) throw new CapsExhausted(caps.stoppedReason);

  const ctx = buildTranscriptContext(turns, contextBudget);
  const resp = await llm.complete(
    [
      {
        role: "user",
        content:
          `CLAIM UNDER DEBATE\n${subject.text}\n\n` +
          `FULL TRANSCRIPT (${ctx.included} of ${turns.length} turns` +
          `${ctx.truncated ? `, ${ctx.omitted} omitted for budget` : ""}):\n${ctx.text}`,
      },
    ],
    { system: SYNTHESIS_SYSTEM, maxTokens: Math.max(maxTurnTokens, 700) },
  );
  caps.recordCall(resp.usage);

  const parsed = validateSynthesis(extractJson(resp.text));
  const result = parsed.ok
    ? parsed
    : {
        // An unusable synthesis is `no_verdict`, not an abort: the transcript is
        // real and public, and the honest report is that the council did not
        // produce a verdict — not that it never happened.
        outcome: "no_verdict",
        verdict:
          `The council ran to completion but its closing synthesis could not be read ` +
          `(${parsed.reason}). The transcript below is the full record of what was argued; ` +
          `no verdict is claimed from it.`,
        vote: {},
      };

  if (!DRY) {
    const { error } = await service
      .from("councils")
      .update({
        status: "complete",
        rounds_run: roundsRun,
        outcome: result.outcome,
        vote: result.vote,
        verdict: result.verdict,
        completed_at: new Date().toISOString(),
      })
      .eq("id", councilId);
    if (error) throw new Error(`close council: ${error.message}`);
  }
  finished = true;

  const truncatedTurns = turns.filter((t) => t.context_truncated).length;
  console.log(`\n  outcome  : ${result.outcome}${parsed.ok ? "" : "  (synthesis unreadable — recorded honestly)"}`);
  console.log(`  rounds   : ${roundsRun}/${rounds} · turns ${turns.length} · truncated ${truncatedTurns}`);
  console.log(`  caps     : ${caps.summary()}`);
  if (councilId) console.log(`\n  /council/${councilId}\n`);
} catch (err) {
  if (err instanceof CapsExhausted) {
    // Out of budget is `no_verdict` on a COMPLETE council (§D.3: "a council that
    // ran out of rounds or budget"), not an abort. The rounds that ran are real.
    if (!DRY && councilId) {
      await service
        .from("councils")
        .update({
          status: "complete",
          rounds_run: roundsRun,
          outcome: "no_verdict",
          verdict:
            `The council stopped early: ${err.message}. ${roundsRun} of ${rounds} rounds completed. ` +
            `What was argued is below; no verdict is claimed from a debate that did not finish.`,
          completed_at: new Date().toISOString(),
        })
        .eq("id", councilId);
    }
    finished = true;
    console.log(`\n  no verdict — ${err.message} (${roundsRun}/${rounds} rounds)\n`);
  } else {
    await abort(err.message ?? String(err));
    console.error(`\n✗ ${err.stack ?? err}`);
    process.exitCode = 1;
  }
}

