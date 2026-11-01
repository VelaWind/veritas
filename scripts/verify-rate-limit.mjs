// Verifies the shared search rate limit (migration 0016) against a real
// database and two running app instances. Writes to rate_limit_hits, so it is
// a tier 3 script: run it against a disposable database, never production.
//
//   BASE_URL=http://localhost:3000 BASE_URL_2=http://localhost:3001 \
//     node scripts/verify-rate-limit.mjs
//
// What it proves, in order:
//   1. Atomicity: 60 concurrent calls for one bucket with max 30, sent through
//      PostgREST's connection pool, come back exactly 30 passed and 30 limited.
//      A read-then-write implementation lets more than 30 through.
//   2. Access: anon cannot execute rate_limit_hit or read rate_limit_hits.
//   3. Across instances: 31 searches from one client, alternating between two
//      separately started servers, are refused at the 31st. With per-instance
//      counts each server would have seen 15 or 16 and let all 31 through.
//   4. Privacy: the stored bucket does not contain the client address.
// Every bucket it creates is deleted at the end.
import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  if (!line || line.startsWith("#") || !line.includes("=")) continue;
  const i = line.indexOf("=");
  process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}

const { createClient } = await import("@supabase/supabase-js");
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, opts);
const anon = createClient(URL_, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, opts);
const BASES = [process.env.BASE_URL ?? "http://localhost:3000", process.env.BASE_URL_2].filter(Boolean);

let pass = 0, fail = 0;
function check(label, ok, detail = "") {
  if (ok) { pass++; console.log(`✓ ${label}`); }
  else { fail++; console.log(`✗ ${label}${detail ? `: ${detail}` : ""}`); }
}

const run = randomBytes(4).toString("hex");
const created = [];

// ── 1. Atomicity under concurrency ──────────────────────────────────────────
console.log("── atomic upsert under concurrency ──");
{
  const bucket = `verify-concurrency-${run}`;
  created.push(bucket);
  const calls = await Promise.all(
    Array.from({ length: 60 }, () =>
      service.rpc("rate_limit_hit", { p_bucket: bucket, p_window_seconds: 60, p_max: 30 })),
  );
  const errors = calls.filter((c) => c.error);
  const passed = calls.filter((c) => c.data === false).length;
  const limited = calls.filter((c) => c.data === true).length;
  check("60 concurrent calls all answered", errors.length === 0, errors[0]?.error?.message ?? "");
  check(`exactly 30 passed and 30 were limited (got ${passed} and ${limited})`, passed === 30 && limited === 30);
  const { data: row } = await service.from("rate_limit_hits").select("hits").eq("bucket", bucket).single();
  check(`the stored count is 60 (got ${row?.hits})`, row?.hits === 60);
}

// ── 2. anon is shut out ─────────────────────────────────────────────────────
console.log("── access ──");
{
  const { error: execErr } = await anon.rpc("rate_limit_hit", { p_bucket: `verify-anon-${run}`, p_window_seconds: 60, p_max: 30 });
  check("anon cannot execute rate_limit_hit", !!execErr, "anon call succeeded");
  const { data: rows, error: readErr } = await anon.from("rate_limit_hits").select("bucket").limit(1);
  check("anon reads nothing from rate_limit_hits", !!readErr || (rows ?? []).length === 0, `read ${rows?.length} rows`);
  created.push(`verify-anon-${run}`);
}

// ── 3. One limit across two app instances ───────────────────────────────────
console.log(`── across instances (${BASES.length} server${BASES.length === 1 ? "" : "s"}) ──`);
const address = `198.51.100.${(parseInt(run.slice(0, 2), 16) % 250) + 1}`;
{
  check("two separate app servers are configured (BASE_URL and BASE_URL_2)", BASES.length === 2, BASES.join(", "));
  const statuses = [];
  for (let i = 0; i < 31; i++) {
    const base = BASES[i % BASES.length];
    const res = await fetch(`${base}/api/search?q=dark`, { headers: { "x-forwarded-for": address } });
    statuses.push(res.status);
  }
  const first30 = statuses.slice(0, 30);
  check("searches 1 to 30 succeed", first30.every((s) => s === 200), JSON.stringify(first30));
  check(`search 31 is refused with 429 (got ${statuses[30]})`, statuses[30] === 429);
}

// ── 4. The table holds a hash, not the address ──────────────────────────────
console.log("── stored bucket ──");
{
  const hashed = `search:${createHash("sha256").update(address).digest("hex")}`;
  created.push(hashed);
  const { data: rows } = await service.from("rate_limit_hits").select("bucket, hits").like("bucket", "search:%");
  const mine = (rows ?? []).find((r) => r.bucket === hashed);
  check("the search bucket is the SHA-256 of the address", !!mine, `no row for ${hashed.slice(0, 20)}`);
  check(`it counted all 31 searches (got ${mine?.hits})`, mine?.hits === 31);
  check("no stored bucket contains the address", !(rows ?? []).some((r) => r.bucket.includes(address)));
}

// ── cleanup ─────────────────────────────────────────────────────────────────
const { error: delErr } = await service.from("rate_limit_hits").delete().in("bucket", created);
check("cleanup: every bucket this run created is deleted", !delErr, delErr?.message ?? "");

console.log(`\n${fail === 0 ? "ALL GREEN" : `${fail} FAILURE(S)`}: ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
