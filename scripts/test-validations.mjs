#!/usr/bin/env node
/**
 * Unit tests for the zod schemas in lib/validations — the PATCH contract.
 *
 *   npm run test:unit
 *
 * WHY THIS EXISTS: zod 4 applies a field's .default() even when the field is
 * optional, so a plain `base.partial()` update schema fills every absent key
 * with its default. An edit that sent only `title` would come back with
 * `assumptions: []`, `open_questions: []` and `falsification_criteria: ""`, and
 * the PATCH would wipe those stored values; an empty note update would set
 * `published: false`. Nothing errors, so only a test catches it.
 * `partialWithoutDefaults()` prevents it; these checks pin that down, and pin
 * that create schemas still apply their defaults.
 *
 * lib/validations imports through the `@/` path alias, which plain Node does not
 * resolve, so a resolve hook below maps `@/x` to `<repo>/x.ts` for this process
 * only. Type stripping is native (Node 22.18+, which CI runs).
 */
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith("@/")) {
      return next(pathToFileURL(resolve(root, `${specifier.slice(2)}.ts`)).href, context);
    }
    return next(specifier, context);
  },
});

const V = await import("../lib/validations/index.ts");

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

const show = (v) => JSON.stringify(v);
const ID = "d0000001-0000-4000-8000-000000000001";

// ── Update schemas add no keys the caller did not send ──────────────────────
console.log("update schemas: absent keys stay absent");
const UPDATES = {
  hypothesisUpdateSchema: { title: "Hot big bang" },
  evidenceUpdateSchema: { title: "CMB data" },
  questionUpdateSchema: { title: "What is it" },
  domainUpdateSchema: { name: "Physics" },
  simulationUpdateSchema: { title: "N body" },
  noteUpdateSchema: { title: "Note one" },
};
for (const [name, input] of Object.entries(UPDATES)) {
  const r = V[name].safeParse(input);
  check(
    `${name}: a one-field edit returns only that field`,
    r.success && show(Object.keys(r.data)) === show(Object.keys(input)),
    `got ${show(r.success ? r.data : r.error.issues)}`,
  );
}
{
  const r = V.noteUpdateSchema.safeParse({});
  check("noteUpdateSchema: an empty edit does not unpublish", r.success && !("published" in r.data), `got ${show(r.data)}`);
}

// ── A field the caller does send is still validated and kept ────────────────
console.log("update schemas: sent fields are still validated");
{
  const r = V.hypothesisUpdateSchema.safeParse({ assumptions: [] });
  check("an explicit empty list is kept", r.success && show(r.data) === show({ assumptions: [] }), `got ${show(r.data)}`);
}
{
  const r = V.evidenceUpdateSchema.safeParse({ strength: 101 });
  check("an out-of-range value is still rejected", !r.success);
}
{
  const r = V.hypothesisUpdateSchema.safeParse({ status: "speculation", confidence: 90 });
  check("the epistemic band still applies on edit", !r.success && r.error.issues.some((i) => i.path.join(".") === "confidence"));
}

// ── Create schemas still apply their defaults ───────────────────────────────
console.log("create schemas: defaults still apply");
{
  const r = V.hypothesisCreateSchema.safeParse({
    slug: "big-bang", domain_id: ID, title: "Hot big bang", description: "d",
    status: "plausible", state: "active", confidence: 40, confidence_rationale: "r",
  });
  check(
    "hypothesisCreateSchema fills assumptions, open_questions, falsification_criteria",
    r.success && show(r.data.assumptions) === "[]" && show(r.data.open_questions) === "[]" && r.data.falsification_criteria === "",
    `got ${show(r.success ? r.data : r.error.issues)}`,
  );
}
{
  const r = V.noteCreateSchema.safeParse({ slug: "n1", title: "Note one", body: "b" });
  check("noteCreateSchema defaults published to false", r.success && r.data.published === false, `got ${show(r.data)}`);
}

// ── Ids accept what zod 3's .uuid() accepted ────────────────────────────────
console.log("ids: unchanged by the zod 4 upgrade");
for (const [label, id, want] of [
  ["a seed-style v4 id", ID, true],
  ["a non-RFC variant (zod 4 .uuid() rejects it, zod 3 did not)", "d0000001-0000-4000-c000-000000000001", true],
  ["a non-id string", "not-a-uuid", false],
]) {
  check(`evidenceLinkSchema: ${label} → ${want ? "accepted" : "rejected"}`,
    V.evidenceLinkSchema.safeParse({ evidenceId: id, relation: "supports" }).success === want);
}

console.log(
  `\n${fail === 0 ? "ALL GREEN" : `${fail} FAILURE(S)`} — ${pass} passed, ${fail} failed`,
);
if (fail > 0) {
  console.log("\nFailed:");
  for (const f of failures) console.log(`  · ${f}`);
}
process.exitCode = fail === 0 ? 0 : 1;
