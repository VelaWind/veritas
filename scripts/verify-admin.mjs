// End-to-end verification of the admin WRITE path against the live DB,
// through the real HTTP routes (middleware → requireAdmin → RLS → triggers).
//
// Needs a dev/prod server running (BASE_URL, default http://localhost:3210).
// Provisions a temporary admin user with the service-role key, signs in,
// forges the @supabase/ssr auth cookie, exercises every admin operation the
// checklist names, then removes every probe artifact:
//   - probe hypothesis runs in state='draft' (never publicly visible)
//   - contradiction scan runs AFTER the probe is deleted so it cannot pair
//     probe data with seeded hypotheses
//   - service role hard-deletes the probe row + its timeline events (cleanup
//     of test artifacts; the append-only invariant binds app roles, not ops)
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  if (!line || line.startsWith("#") || !line.includes("=")) continue;
  const i = line.indexOf("=");
  process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}

const { createClient } = await import("@supabase/supabase-js");

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BASE = process.env.BASE_URL ?? "http://localhost:3210";
const EMAIL = "veritas-verify-admin@example.com";
const PASSWORD = "verify-" + Math.random().toString(36).slice(2) + "A1!";

const service = createClient(URL_, SERVICE, { auth: { persistSession: false } });
const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
// `anon` signs in below and then carries the admin session in memory; this one
// stays genuinely anonymous for public-visibility (RLS) checks.
const publicAnon = createClient(URL_, ANON, { auth: { persistSession: false } });

let pass = 0, fail = 0;
function check(label, ok, detail = "") {
  if (ok) { pass++; console.log(`✓ ${label}`); }
  else { fail++; console.log(`✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

// ── 1. Provision a temp admin ────────────────────────────────────────────────
let userId;
{
  const { data, error } = await service.auth.admin.createUser({
    email: EMAIL, password: PASSWORD, email_confirm: true,
  });
  if (error && /already.*registered|exists/i.test(error.message)) {
    const { data: list } = await service.auth.admin.listUsers();
    const existing = list.users.find((u) => u.email === EMAIL);
    userId = existing.id;
    await service.auth.admin.updateUserById(userId, { password: PASSWORD });
  } else if (error) {
    console.error("Cannot create test user:", error.message);
    process.exit(1);
  } else {
    userId = data.user.id;
  }
  // handle_new_user trigger created the profile; promote it (the documented
  // service-role first-admin path — guard_role_change allows auth.uid()=null).
  const { error: roleErr } = await service
    .from("profiles").update({ role: "admin" }).eq("id", userId);
  check("provision: temp admin user + role promotion", !roleErr, roleErr?.message);
}

// ── 2. Sign in, forge the @supabase/ssr cookie ───────────────────────────────
const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({
  email: EMAIL, password: PASSWORD,
});
check("auth: signInWithPassword", !signInErr, signInErr?.message);
if (signInErr) process.exit(1);

const ref = new URL(URL_).hostname.split(".")[0];
const cookieName = `sb-${ref}-auth-token`;
const encoded = "base64-" + Buffer.from(JSON.stringify(signIn.session)).toString("base64url");
const MAX_CHUNK = 3180;
const cookies = [];
if (encoded.length <= MAX_CHUNK) {
  cookies.push(`${cookieName}=${encoded}`);
} else {
  for (let i = 0; i * MAX_CHUNK < encoded.length; i++) {
    cookies.push(`${cookieName}.${i}=${encoded.slice(i * MAX_CHUNK, (i + 1) * MAX_CHUNK)}`);
  }
}
const COOKIE = cookies.join("; ");

async function call(method, path, body, { auth = true } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(auth ? { Cookie: COOKIE } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, ...((json ?? {})) };
}

// ── 3. Pick seeded fixtures ──────────────────────────────────────────────────
const { data: domain } = await anon.from("domains").select("id, slug").eq("slug", "physics").single();
const { data: evidenceRow } = await anon.from("evidence").select("id, slug").limit(1).single();
check("fixtures: seeded domain + evidence found", !!domain && !!evidenceRow);

const probeSlug = "verify-write-path-probe";
// Remove any leftover from a previous aborted run before starting.
await service.from("hypotheses").delete().eq("slug", probeSlug);

let probeId = null;
try {
  // ── 4. Negative control: unauthenticated write is rejected ────────────────
  const noAuth = await call("POST", "/api/hypotheses", { slug: "x-denied", domain_id: domain.id, title: "denied", description: "x", status: "speculation", state: "draft", confidence: 10, confidence_rationale: "" }, { auth: false });
  check("authz: unauthenticated POST /api/hypotheses → 401", noAuth.status === 401, `got ${noAuth.status}`);

  // ── 5. Create (draft — never publicly visible) ─────────────────────────────
  const created = await call("POST", "/api/hypotheses", {
    slug: probeSlug,
    domain_id: domain.id,
    title: "Verification probe (temporary, draft)",
    description: "Created by scripts/verify-admin.mjs to verify the admin write path. Deleted on completion.",
    status: "speculation",
    state: "draft",
    confidence: 10,
    confidence_rationale: "Probe initial value.",
  });
  probeId = created.data?.id ?? null;
  check("create: POST /api/hypotheses → 201", created.status === 201 && !!probeId, `${created.status} ${created.error ?? ""}`);

  // Draft must be invisible to the public (RLS).
  const { data: anonSees } = await publicAnon.from("hypotheses").select("id").eq("slug", probeSlug).maybeSingle();
  check("rls: draft probe invisible to anon", !anonSees);

  // ── 6. Edit ────────────────────────────────────────────────────────────────
  const edited = await call("PATCH", `/api/hypotheses/${probeId}`, {
    title: "Verification probe (temporary, draft, edited)",
  });
  check("edit: PATCH /api/hypotheses/[id] → 200", edited.status === 200 && edited.data?.title?.endsWith("edited)"), `${edited.status} ${edited.error ?? ""}`);

  // ── 7. Link + unlink evidence ──────────────────────────────────────────────
  const linked = await call("POST", `/api/hypotheses/${probeId}/evidence`, {
    evidenceId: evidenceRow.id, relation: "supports", weight: 60, notes: "probe link",
  });
  check("link: POST /api/hypotheses/[id]/evidence → 201", linked.status === 201 && !!linked.data?.link, `${linked.status} ${linked.error ?? ""}`);

  const { data: edge } = await service.from("graph_edges").select("id").eq("from_id", evidenceRow.id).eq("to_id", probeId).maybeSingle();
  check("trigger: link emitted graph edge", !!edge);

  const unlinked = await call("DELETE", `/api/hypotheses/${probeId}/evidence`, { evidenceId: evidenceRow.id });
  check("unlink: DELETE /api/hypotheses/[id]/evidence → 200", unlinked.status === 200 && unlinked.data?.unlinked === true, `${unlinked.status} ${unlinked.error ?? ""}`);

  const { data: edgeAfter } = await service.from("graph_edges").select("id").eq("from_id", evidenceRow.id).eq("to_id", probeId).maybeSingle();
  check("trigger: unlink removed graph edge", !edgeAfter);

  // ── 8. Confidence change without rationale → rejected ─────────────────────
  const noRationale = await call("PATCH", `/api/hypotheses/${probeId}/confidence`, { value: 25 });
  check("confidence: change WITHOUT rationale rejected (422)", noRationale.status === 422, `got ${noRationale.status}`);

  const blankRationale = await call("PATCH", `/api/hypotheses/${probeId}/confidence`, { value: 25, rationale: "   " });
  check("confidence: blank rationale rejected (422)", blankRationale.status === 422, `got ${blankRationale.status}`);

  // ── 9. Confidence change with rationale → recorded in history ─────────────
  const withRationale = await call("PATCH", `/api/hypotheses/${probeId}/confidence`, {
    value: 25, rationale: "Probe: verifying the confidence audit trail.",
  });
  check("confidence: change WITH rationale → 200", withRationale.status === 200 && withRationale.data?.hypothesis?.confidence === 25, `${withRationale.status} ${withRationale.error ?? ""}`);

  const { data: history } = await service.from("confidence_history").select("old_value, new_value, rationale").eq("hypothesis_id", probeId).order("id", { ascending: false }).limit(1);
  check("trigger: confidence_history row recorded", history?.[0]?.new_value === 25 && history?.[0]?.old_value === 10);

  // Out-of-band value → DB epistemic guard (speculation permits 0–40).
  const outOfBand = await call("PATCH", `/api/hypotheses/${probeId}/confidence`, {
    value: 95, rationale: "Probe: must be rejected by the band guard.",
  });
  check("guard: out-of-band confidence rejected", outOfBand.status === 422 || outOfBand.status === 409, `got ${outOfBand.status}`);
} finally {
  // ── 10. Cleanup probe artifacts (before the scan) ──────────────────────────
  if (probeId) {
    const { error: delErr } = await service.from("hypotheses").delete().eq("id", probeId);
    const { error: tlErr, count } = await service
      .from("timeline_events").delete({ count: "exact" }).eq("node_id", probeId);
    check("cleanup: probe hypothesis + timeline events removed", !delErr && !tlErr, delErr?.message ?? tlErr?.message ?? "");
    if (typeof count === "number") console.log(`  (removed ${count} probe timeline events)`);
  }
}

// ── 11. Contradiction scan (probe already gone — operates on real data only) ─
const scan = await call("POST", "/api/contradictions/scan");
check("scan: POST /api/contradictions/scan → 200", scan.status === 200 && typeof scan.data?.inserted === "number", `${scan.status} ${scan.error ?? ""}`);
if (scan.status === 200) console.log(`  (scan inserted ${scan.data.inserted} new contradiction(s))`);

// ── 12. Remove the temp admin ────────────────────────────────────────────────
{
  await anon.auth.signOut().catch(() => {});
  // Scan-emitted timeline events reference the actor's profile (FK, no
  // cascade); detach before deleting the user so the profile cascade succeeds.
  // The events themselves are legitimate records and stay.
  await service.from("timeline_events").update({ actor_id: null }).eq("actor_id", userId);
  const { error } = await service.auth.admin.deleteUser(userId);
  check("cleanup: temp admin user deleted", !error, error?.message);
}

console.log(`\n${fail === 0 ? "ALL GREEN" : `${fail} FAILURE(S)`} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
