// End-to-end verification of the Phase A suggestion queue against the live DB,
// through the real HTTP routes (middleware → requireContributor/requireAdmin →
// RLS → apply_suggestion → epistemic constraints + audit triggers).
//
// Requires migration 0003_suggestions.sql to be applied to the live DB and a
// dev/prod server running (BASE_URL, default http://localhost:3210). If the
// table is missing it reports BLOCKED (exit 2) rather than a test failure.
//
// Provisions temp admin + two temp researchers + one plain public user, forges
// their @supabase/ssr cookies, exercises propose/approve/reject/withdraw, the
// negative authz + RLS cases, then removes every artifact.
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
const SLUG_PREFIX = "vsugg-";

const service = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

let pass = 0, fail = 0;
function check(label, ok, detail = "") {
  if (ok) { pass++; console.log(`✓ ${label}`); }
  else { fail++; console.log(`✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

// ── Pre-flight: is migration 0003 applied? ───────────────────────────────────
// (Set process.exitCode rather than process.exit() — calling process.exit()
// with undici keep-alive sockets still open trips a libuv assertion on Windows.)
let ready = true;
{
  const { error } = await service.from("suggestions").select("id").limit(1);
  const missing =
    error &&
    (error.code === "42P01" ||
      error.code === "PGRST205" ||
      /does not exist|schema cache|could not find the table/i.test(error.message ?? ""));
  if (missing) {
    console.log("\n⚠ BLOCKED: table `suggestions` not found — apply");
    console.log("  supabase/migrations/0003_suggestions.sql to the live DB, then re-run.");
    ready = false;
    process.exitCode = 2;
  } else if (error) {
    console.log(`✗ pre-flight: unexpected error reading suggestions: ${error.message}`);
    ready = false;
    process.exitCode = 1;
  }
}

const ref = new URL(URL_).hostname.split(".")[0];
const cookieName = `sb-${ref}-auth-token`;
const MAX_CHUNK = 3180;

async function provision(emailLocal, role) {
  const email = `${emailLocal}@example.com`;
  const password = "vsugg-" + Math.random().toString(36).slice(2) + "A1!";
  let userId;
  const { data, error } = await service.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (error && /already.*registered|exists/i.test(error.message)) {
    const { data: list } = await service.auth.admin.listUsers();
    userId = list.users.find((u) => u.email === email).id;
    await service.auth.admin.updateUserById(userId, { password });
  } else if (error) {
    throw new Error(`createUser(${email}): ${error.message}`);
  } else {
    userId = data.user.id;
  }
  if (role !== "public") {
    await service.from("profiles").update({ role }).eq("id", userId);
  }
  const anon = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: signIn, error: sErr } = await anon.auth.signInWithPassword({ email, password });
  if (sErr) throw new Error(`signIn(${email}): ${sErr.message}`);
  const encoded =
    "base64-" + Buffer.from(JSON.stringify(signIn.session)).toString("base64url");
  const cookies = [];
  if (encoded.length <= MAX_CHUNK) cookies.push(`${cookieName}=${encoded}`);
  else for (let i = 0; i * MAX_CHUNK < encoded.length; i++)
    cookies.push(`${cookieName}.${i}=${encoded.slice(i * MAX_CHUNK, (i + 1) * MAX_CHUNK)}`);
  return { email, userId, cookie: cookies.join("; "), client: anon };
}

async function call(cookie, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, ...((json ?? {})) };
}

const created = { hypotheses: [], evidence: [], sources: [], users: [], suggestions: [] };

let admin, researcher, researcher2, publicUser;
async function run() {
 try {
  admin = await provision("vsugg-admin", "admin");
  researcher = await provision("vsugg-researcher", "researcher");
  researcher2 = await provision("vsugg-researcher2", "researcher");
  publicUser = await provision("vsugg-public", "public");
  created.users.push(admin.userId, researcher.userId, researcher2.userId, publicUser.userId);
  check("provision: admin + 2 researchers + public user", true);

  const { data: domain } = await service.from("domains").select("id").eq("slug", "physics").single();

  // ── Negative authz ─────────────────────────────────────────────────────────
  const hypPayload = (slug, title) => ({
    target_type: "hypothesis",
    operation: "create",
    payload: {
      slug, title, domain_id: domain.id,
      description: "Temporary probe from verify-suggestions.mjs.",
      status: "speculation", state: "draft", confidence: 10,
      confidence_rationale: "Probe.", assumptions: [], open_questions: [],
      falsification_criteria: "",
    },
    rationale: "Probe proposal.",
  });

  const anonPropose = await call(null, "POST", "/api/suggestions", hypPayload(`${SLUG_PREFIX}x`, "x"));
  check("authz: anonymous propose → 401", anonPropose.status === 401, `got ${anonPropose.status}`);

  const publicPropose = await call(publicUser.cookie, "POST", "/api/suggestions", hypPayload(`${SLUG_PREFIX}x`, "x"));
  check("authz: public-role propose → 403", publicPropose.status === 403, `got ${publicPropose.status}`);

  // ── Researcher proposes a create ────────────────────────────────────────────
  const createSlug = `${SLUG_PREFIX}create-${Date.now().toString(36)}`;
  const proposed = await call(researcher.cookie, "POST", "/api/suggestions",
    hypPayload(createSlug, "Probe: proposed hypothesis"));
  const suggestionId = proposed.data?.id;
  if (suggestionId) created.suggestions.push(suggestionId);
  check("propose: researcher create → 201 pending",
    proposed.status === 201 && proposed.data?.status === "pending"
    && proposed.data?.proposed_by === researcher.userId, `${proposed.status} ${proposed.error ?? ""}`);

  // The real hypothesis must NOT exist yet.
  const { data: notYet } = await service.from("hypotheses").select("id").eq("slug", createSlug).maybeSingle();
  check("isolation: proposed hypothesis not created until approved", !notYet);

  // Researcher sees own; researcher2 must NOT (RLS).
  const mine = await call(researcher.cookie, "GET", "/api/suggestions?mine=true");
  check("read: proposer sees own suggestion",
    Array.isArray(mine.data) && mine.data.some((s) => s.id === suggestionId));
  const other = await call(researcher2.cookie, "GET", "/api/suggestions");
  check("rls: other researcher cannot see it",
    Array.isArray(other.data) && !other.data.some((s) => s.id === suggestionId));

  // Researcher cannot approve/reject.
  const rApprove = await call(researcher.cookie, "POST", `/api/suggestions/${suggestionId}/approve`, {});
  check("authz: researcher approve → 403", rApprove.status === 403, `got ${rApprove.status}`);

  // Direct RLS probe: researcher tries to self-approve via PostgREST.
  const selfApprove = await researcher.client.from("suggestions")
    .update({ status: "approved" }).eq("id", suggestionId).select();
  check("rls: researcher cannot self-approve via PostgREST",
    (selfApprove.error !== null) || (selfApprove.data?.length ?? 0) === 0,
    selfApprove.error?.message);

  // ── Admin approves ──────────────────────────────────────────────────────────
  const approve = await call(admin.cookie, "POST", `/api/suggestions/${suggestionId}/approve`, {});
  const appliedId = approve.data?.applied_id;
  if (appliedId) created.hypotheses.push(appliedId);
  check("approve: admin approve → 200 applied", approve.status === 200 && !!appliedId,
    `${approve.status} ${approve.error ?? ""}`);

  const { data: nowExists } = await service.from("hypotheses")
    .select("id, created_by, actor_type, state, slug").eq("slug", createSlug).maybeSingle();
  check("apply: hypothesis created, credited to proposer",
    nowExists?.created_by === researcher.userId && nowExists?.actor_type === "human");

  const { data: sugAfter } = await service.from("suggestions")
    .select("status, reviewed_by, applied_id").eq("id", suggestionId).single();
  check("apply: suggestion marked approved by admin",
    sugAfter.status === "approved" && sugAfter.reviewed_by === admin.userId
    && sugAfter.applied_id === appliedId);

  const { data: tl } = await service.from("timeline_events")
    .select("event_type, actor_id").eq("node_id", appliedId).eq("event_type", "hypothesis_created").maybeSingle();
  check("audit: timeline hypothesis_created credits proposer",
    tl?.actor_id === researcher.userId);

  // Re-approving is rejected (no longer pending).
  const reApprove = await call(admin.cookie, "POST", `/api/suggestions/${suggestionId}/approve`, {});
  check("guard: re-approving a decided suggestion fails", reApprove.status === 409, `got ${reApprove.status}`);

  // ── Edit flow ───────────────────────────────────────────────────────────────
  const editProposed = await call(researcher.cookie, "POST", "/api/suggestions", {
    target_type: "hypothesis", operation: "edit", target_id: appliedId,
    payload: { slug: createSlug, title: "Probe: proposed hypothesis (edited)" },
    rationale: "Refine the title.",
  });
  if (editProposed.data?.id) created.suggestions.push(editProposed.data.id);
  check("propose: researcher edit → 201", editProposed.status === 201, `${editProposed.status} ${editProposed.error ?? ""}`);

  const approveEdit = await call(admin.cookie, "POST", `/api/suggestions/${editProposed.data.id}/approve`, {});
  check("approve: edit applied → 200", approveEdit.status === 200, `${approveEdit.status} ${approveEdit.error ?? ""}`);
  const { data: edited } = await service.from("hypotheses").select("title").eq("id", appliedId).single();
  check("apply: edit changed the title", edited.title.endsWith("(edited)"));

  // ── Reject flow ─────────────────────────────────────────────────────────────
  const toReject = await call(researcher.cookie, "POST", "/api/suggestions",
    hypPayload(`${SLUG_PREFIX}reject-${Date.now().toString(36)}`, "Probe: to be rejected"));
  if (toReject.data?.id) created.suggestions.push(toReject.data.id);
  const rejectNoNotes = await call(admin.cookie, "POST", `/api/suggestions/${toReject.data.id}/reject`, {});
  check("reject: requires a reason (422 without notes)", rejectNoNotes.status === 422, `got ${rejectNoNotes.status}`);
  const reject = await call(admin.cookie, "POST", `/api/suggestions/${toReject.data.id}/reject`, { notes: "Out of scope for the probe." });
  check("reject: admin reject with notes → 200", reject.status === 200 && reject.data?.status === "rejected",
    `${reject.status} ${reject.error ?? ""}`);

  // ── Evidence create flow (with inline source) ───────────────────────────────
  const evSlug = `${SLUG_PREFIX}ev-${Date.now().toString(36)}`;
  const evProposed = await call(researcher.cookie, "POST", "/api/suggestions", {
    target_type: "evidence", operation: "create",
    payload: {
      slug: evSlug, title: "Probe: proposed evidence", summary: "Temporary probe.",
      strength: 40, domain_id: domain.id, source_id: null,
      new_source: { title: "Probe source", source_type: "other", reliability: 50 },
    },
    rationale: "New evidence.",
  });
  if (evProposed.data?.id) created.suggestions.push(evProposed.data.id);
  const evApprove = await call(admin.cookie, "POST", `/api/suggestions/${evProposed.data.id}/approve`, {});
  if (evApprove.data?.applied_id) created.evidence.push(evApprove.data.applied_id);
  check("evidence: propose + approve creates evidence + source", evApprove.status === 200 && !!evApprove.data?.applied_id,
    `${evApprove.status} ${evApprove.error ?? ""}`);
  const { data: evRow } = await service.from("evidence").select("source_id, created_by").eq("slug", evSlug).maybeSingle();
  if (evRow?.source_id) created.sources.push(evRow.source_id);
  check("evidence: inline source attached, credited to proposer",
    !!evRow?.source_id && evRow.created_by === researcher.userId);

  // ── Withdraw flow ───────────────────────────────────────────────────────────
  const toWithdraw = await call(researcher.cookie, "POST", "/api/suggestions",
    hypPayload(`${SLUG_PREFIX}wd-${Date.now().toString(36)}`, "Probe: to be withdrawn"));
  if (toWithdraw.data?.id) created.suggestions.push(toWithdraw.data.id);
  const withdraw = await call(researcher.cookie, "POST", `/api/suggestions/${toWithdraw.data.id}/withdraw`, {});
  check("withdraw: proposer withdraws own pending → 200", withdraw.status === 200 && withdraw.data?.status === "withdrawn",
    `${withdraw.status} ${withdraw.error ?? ""}`);
  const approveWithdrawn = await call(admin.cookie, "POST", `/api/suggestions/${toWithdraw.data.id}/approve`, {});
  check("guard: cannot approve a withdrawn suggestion", approveWithdrawn.status === 409, `got ${approveWithdrawn.status}`);
} catch (e) {
  check(`harness error: ${e.message}`, false);
} finally {
  // ── Cleanup (service role; order respects FKs) ──────────────────────────────
  for (const id of created.hypotheses) {
    await service.from("timeline_events").delete().eq("node_id", id);
    await service.from("hypotheses").delete().eq("id", id);
  }
  for (const id of created.evidence) {
    await service.from("timeline_events").delete().eq("node_id", id);
    await service.from("evidence").delete().eq("id", id);
  }
  for (const id of created.sources) await service.from("sources").delete().eq("id", id);
  // Belt-and-suspenders: remove any stray probe rows by slug prefix.
  await service.from("hypotheses").delete().like("slug", `${SLUG_PREFIX}%`);
  await service.from("evidence").delete().like("slug", `${SLUG_PREFIX}%`);
  for (const id of created.suggestions) await service.from("suggestions").delete().eq("id", id);
  for (const u of [researcher, researcher2, publicUser, admin]) {
    if (!u) continue;
    await u.client.auth.signOut().catch(() => {});
    await service.from("suggestions").update({ reviewed_by: null }).eq("reviewed_by", u.userId);
    await service.from("suggestions").delete().eq("proposed_by", u.userId);
    await service.auth.admin.deleteUser(u.userId).catch(() => {});
  }
  check("cleanup: probe artifacts + temp users removed", true);
 }
}

if (ready) {
  await run();
  console.log(`\n${fail === 0 ? "ALL GREEN" : `${fail} FAILURE(S)`} — ${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
}
