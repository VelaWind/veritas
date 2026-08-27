#!/usr/bin/env node
/**
 * Unit tests for `buildTranscriptContext` — the council context budget (§D.3).
 *
 *   npm run test:unit
 *
 * WHY THIS EXISTS: the budget is the part of the council lane that fails
 * SILENTLY. If it stops trimming, round 3 overflows a 32k local context and the
 * model quietly ignores the earliest arguments — and the stored transcript then
 * shows a turn answering points it demonstrably never saw. That reads as
 * reasoning and is not. Nothing else catches it: `smoke` asserts the marker
 * renders, `verify-agents` asserts the column exists, and both would stay green
 * against a budget that had silently stopped binding.
 *
 * The function is PURE — (turns, budget) in, selection out — so this file needs
 * no fixtures, no live database, and no model. That is the whole reason the
 * budget lives in its own module instead of inside the runner loop.
 *
 * No framework, no dependency, plain node — same style as test-sanitize.mjs.
 */
import {
  TRUNCATION_MARKER,
  buildTranscriptContext,
  estimateTokens,
} from "./agent-lib/council.mjs";

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

/**
 * A turn whose rendered cost is predictable. `renderTurn` joins a header, the
 * content, and the reasoning, so the body dominates: 800 chars of content +
 * 800 of reasoning ≈ 400 estimated tokens, matching the per-turn output cap the
 * runner actually uses. Sizing the fixtures to the real cap is deliberate —
 * a budget tested only against toy turns is not tested against its own job.
 */
const mkTurn = (round, role, chars = 800) => ({
  round,
  role,
  content: `${role.toUpperCase()}-CONTENT ` + "c".repeat(chars),
  reasoning: `${role.toUpperCase()}-REASONING ` + "r".repeat(chars),
});

const ROLES = ["advocate", "skeptic", "verifier", "synthesizer"];
const FOUR = ROLES.map((r) => mkTurn(1, r));

/** Which roles survived into the rendered transcript, in render order. */
const rolesIn = (text) =>
  [...text.matchAll(/--- round \d+ · (\w+) ---/g)].map((m) => m[1]);

const perTurn = estimateTokens(FOUR[0].content) + estimateTokens(FOUR[0].reasoning);
console.log(`── fixture: 4 turns, ~${perTurn} est. tokens each ──\n`);

// ── 1. The five budget levels ───────────────────────────────────────────────
// One table rather than five prose assertions, because the interesting property
// is MONOTONIC: as the budget falls, `included` falls and `omitted` rises, and
// it never goes below the floor of 1.
console.log("── 1. Budget levels ──");
{
  const cases = [
    { budget: 100_000, included: 4, omitted: 0, truncated: false },
    { budget: 900, included: 2, omitted: 2, truncated: true },
    { budget: 450, included: 1, omitted: 3, truncated: true },
    { budget: 200, included: 1, omitted: 3, truncated: true },
    { budget: 0, included: 1, omitted: 3, truncated: true },
  ];
  for (const c of cases) {
    const r = buildTranscriptContext(FOUR, c.budget);
    check(
      `budget ${String(c.budget).padStart(6)} → ${c.included} kept, ${c.omitted} dropped, truncated=${c.truncated}`,
      r.included === c.included && r.omitted === c.omitted && r.truncated === c.truncated,
      `got included=${r.included} omitted=${r.omitted} truncated=${r.truncated} tokens=${r.tokens}`,
    );
  }

  // The property behind the table: never lose a turn as the budget RISES.
  let prev = -1;
  let monotonic = true;
  for (const b of [0, 200, 450, 900, 100_000]) {
    const { included } = buildTranscriptContext(FOUR, b);
    if (included < prev) monotonic = false;
    prev = included;
  }
  check("included never decreases as the budget increases", monotonic);
}

// ── 2. Newest-first SELECTION ───────────────────────────────────────────────
// When the budget binds, what survives must be what the next turn is answering.
// Keeping the OLDEST turns would still produce a plausible-looking transcript
// of the right length — this is the assertion that tells the two apart.
console.log("\n── 2. Selection is newest-first ──");
{
  const r = buildTranscriptContext(FOUR, 900);
  const kept = rolesIn(r.text);
  check(
    "a tight budget keeps the two NEWEST turns (verifier, synthesizer)",
    kept.length === 2 && kept[0] === "verifier" && kept[1] === "synthesizer",
    `kept ${JSON.stringify(kept)}`,
  );
  check(
    "…and drops the two oldest (advocate, skeptic)",
    !r.text.includes("ADVOCATE-CONTENT") && !r.text.includes("SKEPTIC-CONTENT"),
  );

  const single = buildTranscriptContext(FOUR, 450);
  check(
    "the tightest budget keeps the single newest turn, not the oldest",
    rolesIn(single.text).join(",") === "synthesizer",
    `kept ${JSON.stringify(rolesIn(single.text))}`,
  );
}

// ── 3. Chronological RENDER order ───────────────────────────────────────────
// Selection is newest-first; presentation must not be. A debate read backwards
// is not a debate, and the model would be answering the future.
console.log("\n── 3. Render order is chronological ──");
{
  const all = buildTranscriptContext(FOUR, 100_000);
  check(
    "an unbudgeted transcript renders oldest → newest",
    rolesIn(all.text).join(",") === ROLES.join(","),
    `got ${JSON.stringify(rolesIn(all.text))}`,
  );

  const trimmed = buildTranscriptContext(FOUR, 900);
  check(
    "a trimmed transcript ALSO renders oldest → newest, not selection order",
    rolesIn(trimmed.text).join(",") === "verifier,synthesizer",
    `got ${JSON.stringify(rolesIn(trimmed.text))}`,
  );

  // Multi-round: rounds must not interleave after the reverse.
  const twoRounds = [...FOUR, ...ROLES.map((r) => mkTurn(2, r))];
  const rounds = [...buildTranscriptContext(twoRounds, 100_000).text.matchAll(/--- round (\d+) ·/g)]
    .map((m) => Number(m[1]));
  check(
    "round numbers are non-decreasing across a two-round transcript",
    rounds.every((n, i) => i === 0 || n >= rounds[i - 1]),
    `got ${JSON.stringify(rounds)}`,
  );
}

// ── 4. The one-turn floor ───────────────────────────────────────────────────
// Documented behaviour, asserted so it stays deliberate: a turn that cannot see
// the argument immediately before it is not in a debate, so the newest turn is
// included even when it alone blows the budget. This is the one place the
// budget is knowingly exceeded, which is exactly why it needs a test.
console.log("\n── 4. The floor of one turn ──");
{
  for (const budget of [0, 1, -5, Number.NaN]) {
    const r = buildTranscriptContext(FOUR, budget);
    check(
      `budget ${String(budget)} still yields exactly one turn`,
      r.included === 1 && r.omitted === 3,
      `got included=${r.included} omitted=${r.omitted}`,
    );
  }

  const r = buildTranscriptContext(FOUR, 0);
  check(
    "the floor OVERSHOOTS the budget rather than returning nothing",
    r.tokens > 0 && r.text.includes("SYNTHESIZER-CONTENT"),
    `tokens=${r.tokens}`,
  );

  const one = buildTranscriptContext([mkTurn(1, "advocate")], 0);
  check(
    "a single over-budget turn is kept and is NOT marked truncated",
    one.included === 1 && one.omitted === 0 && one.truncated === false,
    `got included=${one.included} omitted=${one.omitted} truncated=${one.truncated}`,
  );
}

// ── 5. Marker present IFF truncated ─────────────────────────────────────────
// Both directions. A marker that appears when nothing was dropped is a false
// alarm on a public page; one that fails to appear when something WAS dropped
// is the silent failure this whole module exists to prevent.
console.log("\n── 5. The marker appears exactly when it should ──");
{
  for (const budget of [100_000, 5000]) {
    const r = buildTranscriptContext(FOUR, budget);
    check(
      `budget ${budget}: nothing dropped → no marker`,
      r.truncated === false && !r.text.includes(TRUNCATION_MARKER),
      `truncated=${r.truncated}`,
    );
  }
  for (const budget of [900, 450, 0]) {
    const r = buildTranscriptContext(FOUR, budget);
    check(
      `budget ${budget}: turns dropped → marker present`,
      r.truncated === true && r.text.includes(TRUNCATION_MARKER),
      `truncated=${r.truncated}, marker=${r.text.includes(TRUNCATION_MARKER)}`,
    );
  }

  const r = buildTranscriptContext(FOUR, 900);
  check(
    "the marker states how many turns were omitted",
    r.text.includes("2 earlier turns omitted") && r.text.includes("most recent 2 of 4"),
    `marker line: ${JSON.stringify(r.text.split("\n")[0])}`,
  );
  check(
    "the marker leads the transcript rather than trailing it",
    r.text.startsWith(TRUNCATION_MARKER),
    `starts with ${JSON.stringify(r.text.slice(0, 40))}`,
  );

  const singular = buildTranscriptContext(FOUR.slice(0, 2), 450);
  check(
    "one omitted turn reads 'turn', not 'turns'",
    singular.text.includes("1 earlier turn omitted"),
    `marker line: ${JSON.stringify(singular.text.split("\n")[0])}`,
  );
}

// ── 6. No prior turns ───────────────────────────────────────────────────────
// The opening turn of every council. Truncated must be FALSE here — an empty
// transcript is not a trimmed one, and marking it true would put a truncation
// badge on the first turn of every council page.
console.log("\n── 6. The empty case ──");
{
  const r = buildTranscriptContext([], 6000);
  check(
    "no prior turns → empty text, nothing truncated",
    r.text === "" && r.truncated === false && r.included === 0 && r.omitted === 0 && r.tokens === 0,
    JSON.stringify(r),
  );
  check(
    "no prior turns → no marker (an empty transcript is not a trimmed one)",
    !r.text.includes(TRUNCATION_MARKER),
  );

  for (const [label, input] of [
    ["null", null],
    ["undefined", undefined],
    ["a non-array", "not an array"],
  ]) {
    const bad = buildTranscriptContext(input, 6000);
    check(
      `${label} is treated as no prior turns rather than throwing`,
      bad.text === "" && bad.truncated === false && bad.included === 0,
      JSON.stringify(bad),
    );
  }
}

console.log(
  `\n${fail === 0 ? "ALL GREEN" : `${fail} FAILURE(S)`} — ${pass} passed, ${fail} failed`,
);
if (fail > 0) {
  console.log("\nFailed:");
  for (const f of failures) console.log(`  · ${f}`);
}
process.exitCode = fail === 0 ? 0 : 1;
