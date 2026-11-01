#!/usr/bin/env node
/**
 * Unit tests for lib/rate-limit.ts: the decision logic around the shared
 * Postgres count (migration 0016).
 *
 *   npm run test:unit
 *
 * WHY THIS EXISTS: the point of the change is that two serverless instances
 * share one count. The tests below model two instances as two limiters over one
 * store and assert the 31st request across BOTH is refused, which two in-memory
 * limiters would not do. They also pin the fallback: a store that cannot answer
 * must degrade to the old per-instance count, never to "no limit" and never to
 * "refuse everything". The atomicity of the SQL itself is tested against a real
 * database in CI tier 3 (scripts/verify-rate-limit.mjs).
 *
 * lib/rate-limit.ts has zero imports, so plain Node loads it with type stripping.
 */
import { createHash } from "node:crypto";
import {
  bucketFor,
  createMemoryLimiter,
  createRateLimiter,
} from "../lib/rate-limit.ts";

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

const POLICY = { windowMs: 60_000, max: 30 };

/** A fake shared store with the SQL function's semantics, on a fake clock. */
function fakeSharedStore(clock) {
  const rows = new Map();
  return async (bucket, policy) => {
    const t = clock.now;
    const r = rows.get(bucket);
    if (!r || r.windowStart < t - policy.windowMs) {
      rows.set(bucket, { windowStart: t, hits: 1 });
      return 1 > policy.max;
    }
    r.hits += 1;
    return r.hits > policy.max;
  };
}

// ── The in-memory limiter keeps its old behaviour ───────────────────────────
console.log("memory limiter (the fallback): unchanged behaviour");
{
  const clock = { now: 0 };
  const limited = createMemoryLimiter(POLICY, () => clock.now);
  const first30 = Array.from({ length: 30 }, () => limited("a"));
  check("the first 30 hits in a window pass", first30.every((x) => x === false));
  check("hit 31 is limited", limited("a") === true);
  check("another bucket is counted separately", limited("b") === false);
  clock.now = 60_000;
  check("at exactly windowMs the window is still open", limited("a") === true);
  clock.now = 60_001;
  check("after windowMs a new window opens", limited("a") === false);
}

// ── Two instances over one shared store share one count ─────────────────────
console.log("shared store: the limit holds across instances");
{
  const clock = { now: 0 };
  const store = fakeSharedStore(clock);
  const instanceA = createRateLimiter({ policy: POLICY, store, now: () => clock.now });
  const instanceB = createRateLimiter({ policy: POLICY, store, now: () => clock.now });
  const results = [];
  for (let i = 0; i < 31; i++) results.push(await (i % 2 ? instanceB : instanceA)("ip"));
  check("30 hits split across two instances all pass", results.slice(0, 30).every((r) => !r.limited));
  check("hit 31 is limited, though each instance saw only 15 or 16", results[30].limited === true);
  check("every answer came from the shared store", results.every((r) => r.source === "shared"));

  const memA = createMemoryLimiter(POLICY);
  const memB = createMemoryLimiter(POLICY);
  let allowed = 0;
  for (let i = 0; i < 60; i++) if (!(i % 2 ? memB : memA)("ip")) allowed++;
  check("control: two in-memory instances let 60 through (the bug being fixed)", allowed === 60, `allowed ${allowed}`);
}

// ── The fallback: degrade to per-instance, never to no limit ────────────────
console.log("fallback when the shared store cannot answer");
{
  const reasons = [];
  const nullStore = createRateLimiter({ policy: POLICY, store: async () => null });
  const r = [];
  for (let i = 0; i < 31; i++) r.push(await nullStore("ip"));
  check("a store resolving null falls back to memory", r.every((x) => x.source === "memory"));
  check("the fallback still limits hit 31", r[30].limited === true && r.slice(0, 30).every((x) => !x.limited));

  const throwing = createRateLimiter({
    policy: POLICY,
    store: async () => { throw new Error("connection refused"); },
    onFallback: (why) => reasons.push(why),
  });
  const t = await throwing("ip");
  check("a store that throws falls back to memory and does not block", t.source === "memory" && t.limited === false);
  check("the throw is reported to onFallback", reasons[0] === "connection refused", `got ${JSON.stringify(reasons)}`);

  const sharedSaysNo = createRateLimiter({ policy: POLICY, store: async () => false });
  let anyLimited = false;
  for (let i = 0; i < 40; i++) if ((await sharedSaysNo("ip")).limited) anyLimited = true;
  check("when the store answers, its answer wins over a full memory count", !anyLimited);
}

// ── Buckets never hold the address ──────────────────────────────────────────
console.log("buckets");
{
  const sha = async (s) => createHash("sha256").update(s).digest("hex");
  const a = await bucketFor("search", "203.0.113.7", sha);
  const b = await bucketFor("search", "203.0.113.8", sha);
  check("the bucket does not contain the address", !a.includes("203.0.113.7"), a);
  check("the bucket is the scope plus a SHA-256 hex digest", /^search:[0-9a-f]{64}$/.test(a), a);
  check("the same address gives the same bucket", a === (await bucketFor("search", "203.0.113.7", sha)));
  check("different addresses give different buckets", a !== b);
  check("a bucket fits the database's 200-character limit", a.length <= 200, `length ${a.length}`);
}

console.log(
  `\n${fail === 0 ? "ALL GREEN" : `${fail} FAILURE(S)`}: ${pass} passed, ${fail} failed`,
);
if (fail > 0) {
  console.log("\nFailed:");
  for (const f of failures) console.log(`  · ${f}`);
}
process.exitCode = fail === 0 ? 0 : 1;
