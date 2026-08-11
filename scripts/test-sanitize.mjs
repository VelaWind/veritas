#!/usr/bin/env node
/**
 * Unit tests for `sanitizeHeadline` — the XSS guard (AUDIT.md F-02).
 *
 *   npm run test:unit
 *
 * WHY THIS EXISTS: `sanitizeHeadline` escapes a Postgres ts_headline() snippet
 * and then deliberately re-enables <b>/</b>, and the result goes straight into
 * `dangerouslySetInnerHTML` at two call sites:
 *     app/(public)/search/page.tsx:80
 *     components/layout/CommandPalette.tsx:182
 * It was the single piece of security-relevant code in this repository with no
 * coverage of any kind. `smoke.ts` requests /search but asserts only that rows
 * come back — never that anything is escaped — so a regression that let a
 * <script> through would have passed all 151 integration assertions.
 *
 * No framework, no dependency, plain node — same style as scripts/smoke.ts.
 * It imports lib/sanitize.ts directly, which is why that module has zero
 * imports: lib/utils.ts pulls in `@/lib/supabase/env` for the F-04 guard, and
 * plain node cannot resolve that path alias.
 *
 * NOTE ON WHAT IS *NOT* ASSERTED HERE — idempotency. `sanitizeHeadline` is not
 * idempotent by design: its output is HTML, so applying it twice double-escapes
 * (`&lt;` becomes `&amp;lt;`). That is correct behaviour for an escaper, and
 * both call sites above apply it exactly once, to `r.snippet`, at the point of
 * render. Nothing pre-sanitizes upstream. An idempotency assertion would be
 * testing a property the function does not promise and does not need.
 */
import { sanitizeHeadline } from "../lib/sanitize.ts";

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

const show = (s) => JSON.stringify(s);

/**
 * The core security invariant: after sanitizing, the ONLY raw markup permitted
 * in the output is <b> and </b>. Strip those and no angle bracket may survive.
 * This is stronger than blocklisting known-bad tags — it whitelists the two
 * tags the carve-out exists for and rejects everything else by construction.
 */
const stripAllowed = (s) => s.split("<b>").join("").split("</b>").join("");
const onlyBoldSurvives = (s) => !/[<>]/.test(stripAllowed(s));

console.log("── 1. XSS: dangerous markup is inert ──");
for (const [name, input] of [
  ["script tag", "<script>alert(1)</script>"],
  ["img onerror", "<img src=x onerror=alert(1)>"],
  ["svg onload", "<svg/onload=alert(1)>"],
  ["iframe javascript:", "<iframe src=javascript:alert(1)></iframe>"],
  ["b with onmouseover", '<b onmouseover="alert(1)">x</b>'],
  ["b with style expression", '<b style="width:expression(alert(1))">x</b>'],
  ["closing-tag breakout", "</span><script>alert(1)</script>"],
  ["attribute breakout", '" onmouseover="alert(1)'],
]) {
  const out = sanitizeHeadline(input);
  check(`${name} → nothing but <b>/</b> survives`, onlyBoldSurvives(out), `got ${show(out)}`);
}

console.log("\n── 2. The deliberate carve-out still works ──");
check(
  "<b>…</b> is re-enabled",
  sanitizeHeadline("<b>quantum</b> mechanics") === "<b>quantum</b> mechanics",
  `got ${show(sanitizeHeadline("<b>quantum</b> mechanics"))}`,
);
check(
  "multiple highlights are re-enabled",
  sanitizeHeadline("<b>a</b> and <b>b</b>") === "<b>a</b> and <b>b</b>",
  `got ${show(sanitizeHeadline("<b>a</b> and <b>b</b>"))}`,
);
check(
  "a realistic ts_headline snippet survives intact",
  sanitizeHeadline("Reality is <b>fundamentally</b> physical") ===
    "Reality is <b>fundamentally</b> physical",
  `got ${show(sanitizeHeadline("Reality is <b>fundamentally</b> physical"))}`,
);

console.log("\n── 3. THE & ESCAPE — the escape-then-unescape hole ──");
// Named separately rather than folded into the XSS block, because this is the
// one regression that turns *displayed text* into *markup*.
//
// If the `&` escape is REMOVED, source text containing the literal characters
// `&lt;b&gt;` passes through the escape pass untouched, and the re-enable step
// then promotes it into a real <b> tag. Verified by deleting that .replace()
// and re-running this file: sanitizeHeadline("&lt;b&gt;not bold&lt;/b&gt;")
// returns "<b>not bold</b>", and these assertions fail.
//
// Escaping `&` LAST instead of first is a different failure and is NOT caught
// here — it does not open the hole, it double-escapes ts_headline's own markers
// so the highlight stops working. Section 2 catches that one.
{
  const out = sanitizeHeadline("&lt;b&gt;not bold&lt;/b&gt;");
  check(
    "already-escaped &lt;b&gt; in source is NOT promoted to real markup",
    !out.includes("<b>") && !out.includes("</b>"),
    `got ${show(out)} — if this fails, the & escape is gone and literal text is being turned into real markup`,
  );
  check(
    "  …and it is double-escaped so it renders as visible text",
    out.startsWith("&amp;lt;b&amp;gt;"),
    `got ${show(out)}`,
  );
}
{
  // The same hole one level up: a literal `&amp;lt;b&amp;gt;` must not collapse.
  const out = sanitizeHeadline("&amp;lt;b&amp;gt;");
  check(
    "already-double-escaped source does not collapse into markup",
    !out.includes("<b>"),
    `got ${show(out)}`,
  );
}

console.log("\n── 4. Malformed input is still inert ──");
check(
  "<b> WITH ATTRIBUTES is not re-enabled",
  !sanitizeHeadline('<b onmouseover="alert(1)">x</b>').includes("<b "),
  `got ${show(sanitizeHeadline('<b onmouseover="alert(1)">x</b>'))}`,
);
check(
  "uppercase <B> is not re-enabled (match is case-sensitive)",
  !/<[Bb]>/.test(sanitizeHeadline("<B>UPPERCASE</B>")),
  `got ${show(sanitizeHeadline("<B>UPPERCASE</B>"))}`,
);
check(
  "nested <b> stays inert beyond the carve-out",
  onlyBoldSurvives(sanitizeHeadline("<b><b>nested</b></b>")),
  `got ${show(sanitizeHeadline("<b><b>nested</b></b>"))}`,
);

console.log("\n── 5. Plain-text escaping ──");
check(
  "quotes and ampersand are escaped",
  sanitizeHeadline(`He said "hi" & 'bye'`) === "He said &quot;hi&quot; &amp; &#39;bye&#39;",
  `got ${show(sanitizeHeadline(`He said "hi" & 'bye'`))}`,
);
check("empty string → empty string", sanitizeHeadline("") === "", "");

console.log("\n── 6. CHARACTERIZATION — current behaviour, NOT desired behaviour ──");
// These record what the function does TODAY with a literal <b> or </b> in the
// source text: it emits unbalanced markup. This is AUDIT.md F-10, accepted as a
// LOW cosmetic limitation rather than fixed — it is contained by the fragment
// parser at the container boundary, carries no security consequence (<b> has no
// attributes and no script capability, as section 1 proves), and is unreachable
// from ts_headline itself, which always emits balanced tags.
//
// They are written as assertions so the behaviour cannot change unnoticed. If a
// future change balances the output, these SHOULD fail — update them and F-10
// together. Do not read them as a specification.
{
  const out = sanitizeHeadline("<b>unclosed bold");
  check(
    "[characterization] unclosed <b> is emitted unclosed",
    out === "<b>unclosed bold",
    `got ${show(out)}`,
  );
  check("  …and is still inert", onlyBoldSurvives(out), `got ${show(out)}`);
}
{
  const out = sanitizeHeadline("<b</b>");
  check(
    "[characterization] malformed <b</b> emits an orphan closer",
    out === "&lt;b</b>",
    `got ${show(out)}`,
  );
  check("  …and is still inert", onlyBoldSurvives(out), `got ${show(out)}`);
}
{
  const out = sanitizeHeadline("</b>orphan closer");
  check(
    "[characterization] orphan </b> is passed through",
    out === "</b>orphan closer",
    `got ${show(out)}`,
  );
  check("  …and is still inert", onlyBoldSurvives(out), `got ${show(out)}`);
}

console.log(
  `\n${fail === 0 ? "ALL GREEN" : `${fail} FAILURE(S)`} — ${pass} passed, ${fail} failed`,
);
if (fail > 0) {
  console.log("\nFailed:");
  for (const f of failures) console.log(`  · ${f}`);
}
process.exitCode = fail === 0 ? 0 : 1;
