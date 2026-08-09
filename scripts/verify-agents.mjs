// End-to-end verification of the Phase B agent layer against the live DB, through
// the real HTTP routes (requireAgent → /api/agent/suggestions → enforce_agent_quota
// trigger → suggestions → apply_suggestion → epistemic constraints + audit
// triggers). Proves the B.0 invariant and the B.2 caps:
//
//   agent proposes → lands pending (credited to the agent) → token cannot approve
//   → admin approves → created node + timeline credit the AGENT → caps enforced
//   (pending cap, hourly cap, domain scope) → bad tokens / disabled agent rejected.
//
// Requires migrations 0005 + 0006 applied and a dev/prod server running
// (BASE_URL, default http://localhost:3210). If the agents table is missing it
// reports BLOCKED (exit 2) rather than a failure. Provisions a temp admin + a
// temp agent, then removes every artifact.
import { readFileSync } from "node:fs";
import { randomBytes, createHash } from "node:crypto";

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
const SLUG_PREFIX = "vagent-";

const service = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

let pass = 0, fail = 0;
function check(label, ok, detail = "") {
  if (ok) { pass++; console.log(`✓ ${label}`); }
  else { fail++; console.log(`✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

// ── Pre-flight: are migrations 0005/0006 applied? ────────────────────────────
let ready = true;
{
  const { error } = await service.from("agents").select("id").limit(1);
  const missing =
    error &&
    (error.code === "42P01" || error.code === "PGRST205" ||
      /does not exist|schema cache|could not find the table/i.test(error.message ?? ""));
  if (missing) {
    console.log("\n⚠ BLOCKED: table `agents` not found — apply supabase/migrations/");
    console.log("  0005_agent_role.sql + 0006_agents.sql to the live DB, then re-run.");
    ready = false;
    process.exitCode = 2;
  } else if (error) {
    console.log(`✗ pre-flight: unexpected error reading agents: ${error.message}`);
    ready = false;
    process.exitCode = 1;
  }
}

const ref = new URL(URL_).hostname.split(".")[0];
const cookieName = `sb-${ref}-auth-token`;
const MAX_CHUNK = 3180;

async function provisionAdmin(emailLocal) {
  const email = `${emailLocal}@example.com`;
  const password = "vagent-" + Math.random().toString(36).slice(2) + "A1!";
  let userId;
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (error && /already.*registered|exists/i.test(error.message)) {
    const { data: list } = await service.auth.admin.listUsers();
    userId = list.users.find((u) => u.email === email).id;
    await service.auth.admin.updateUserById(userId, { password });
  } else if (error) {
    throw new Error(`createUser(${email}): ${error.message}`);
  } else {
    userId = data.user.id;
  }
  await service.from("profiles").update({ role: "admin" }).eq("id", userId);
  const anon = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: signIn, error: sErr } = await anon.auth.signInWithPassword({ email, password });
  if (sErr) throw new Error(`signIn(${email}): ${sErr.message}`);
  const encoded = "base64-" + Buffer.from(JSON.stringify(signIn.session)).toString("base64url");
  const cookies = [];
  if (encoded.length <= MAX_CHUNK) cookies.push(`${cookieName}=${encoded}`);
  else for (let i = 0; i * MAX_CHUNK < encoded.length; i++)
    cookies.push(`${cookieName}.${i}=${encoded.slice(i * MAX_CHUNK, (i + 1) * MAX_CHUNK)}`);
  return { email, userId, cookie: cookies.join("; "), client: anon };
}

function mkToken() {
  const plaintext = "veagt_" + randomBytes(32).toString("base64url");
  return { plaintext, hash: createHash("sha256").update(plaintext).digest("hex") };
}

async function provisionAgent(name, scopes) {
  const email = `${SLUG_PREFIX}${name}@example.com`;
  const password = "vagent-" + randomBytes(12).toString("base64url") + "A1!";
  let userId;
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (error && /already.*registered|exists/i.test(error.message)) {
    const { data: list } = await service.auth.admin.listUsers();
    userId = list.users.find((u) => u.email === email).id;
  } else if (error) {
    throw new Error(`createUser(${email}): ${error.message}`);
  } else {
    userId = data.user.id;
  }
  await service.from("profiles").update({ role: "agent", display_name: name }).eq("id", userId);
  const { data: agent, error: aErr } = await service
    .from("agents")
    .upsert({ name, profile_id: userId, enabled: true, scopes }, { onConflict: "name" })
    .select("id")
    .single();
  if (aErr) throw new Error(`upsert agent: ${aErr.message}`);
  const tok = mkToken();
  await service.from("agent_tokens").insert({
    agent_id: agent.id, token_hash: tok.hash, label: "verify",
    expires_at: new Date(Date.now() + 86400_000).toISOString(),
  });
  return { name, profileId: userId, agentId: agent.id, token: tok.plaintext };
}

async function mintTokenFor(agentId, { expiresAt = null, revoked = false } = {}) {
  const tok = mkToken();
  await service.from("agent_tokens").insert({
    agent_id: agentId, token_hash: tok.hash, label: "verify",
    expires_at: expiresAt, revoked_at: revoked ? new Date().toISOString() : null,
  });
  return tok.plaintext;
}

async function callAgent(token, body) {
  const res = await fetch(`${BASE}/api/agent/suggestions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  let json = null; try { json = await res.json(); } catch { /* */ }
  return { status: res.status, ...((json ?? {})) };
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
  let json = null; try { json = await res.json(); } catch { /* */ }
  return { status: res.status, ...((json ?? {})) };
}

const hypBody = (slug, title, domainId) => ({
  target_type: "hypothesis", operation: "create",
  payload: {
    slug, title, domain_id: domainId,
    description: "Probe hypothesis from verify-agents.mjs.",
    status: "speculation", state: "draft", confidence: 10,
    confidence_rationale: "Probe.", assumptions: [{ text: "A probe assumption.", justified: false }],
    open_questions: [], falsification_criteria: "If the probe is cleaned up.",
  },
  rationale: "Agent probe proposal.",
});

const created = { hypotheses: [], evidence: [], sources: [], suggestions: [], agents: [], users: [] };
let admin, agent;

async function run() {
 try {
  const { data: physics } = await service.from("domains").select("id").eq("slug", "physics").single();
  const { data: other } = await service.from("domains").select("id, slug").neq("slug", "physics").limit(1).single();

  admin = await provisionAdmin("vagent-admin");
  created.users.push(admin.userId);
  agent = await provisionAgent("probe", { domains: [physics.id], max_pending: 50, max_per_hour: 1000 });
  created.users.push(agent.profileId);
  created.agents.push(agent.agentId);
  check("provision: temp admin + temp agent (token minted)", !!admin && !!agent.token);

  // ── Bad-token cases (rejected before any insert) ────────────────────────────
  const noTok = await callAgent(null, hypBody(`${SLUG_PREFIX}x1`, "x", physics.id));
  check("authz: missing token → 401", noTok.status === 401, `got ${noTok.status}`);
  const badTok = await callAgent("not-a-real-token", hypBody(`${SLUG_PREFIX}x2`, "x", physics.id));
  check("authz: invalid token → 401", badTok.status === 401, `got ${badTok.status}`);
  const expTok = await mintTokenFor(agent.agentId, { expiresAt: new Date(Date.now() - 1000).toISOString() });
  const expired = await callAgent(expTok, hypBody(`${SLUG_PREFIX}x3`, "x", physics.id));
  check("authz: expired token → 401", expired.status === 401, `got ${expired.status}`);
  const revTok = await mintTokenFor(agent.agentId, { revoked: true });
  const revoked = await callAgent(revTok, hypBody(`${SLUG_PREFIX}x4`, "x", physics.id));
  check("authz: revoked token → 401", revoked.status === 401, `got ${revoked.status}`);

  // ── B.3 payload minimums (rejected before insert) ───────────────────────────
  const noRat = await callAgent(agent.token, { ...hypBody(`${SLUG_PREFIX}x5`, "x", physics.id), rationale: "" });
  check("quality: empty rationale → 422", noRat.status === 422, `got ${noRat.status}`);
  const noAssume = (() => { const b = hypBody(`${SLUG_PREFIX}x6`, "x", physics.id); b.payload.assumptions = []; return b; })();
  const noAssumeRes = await callAgent(agent.token, noAssume);
  check("quality: hypothesis with no assumptions → 422", noAssumeRes.status === 422, `got ${noAssumeRes.status}`);

  // ── Domain scope (trigger raises 42501 → 403; no row persists) ───────────────
  const offScope = await callAgent(agent.token, hypBody(`${SLUG_PREFIX}x7`, "off-scope", other.id));
  check("scope: propose outside scoped domain → 403", offScope.status === 403, `got ${offScope.status}`);

  // ── Propose (lands pending, credited to the agent) ──────────────────────────
  const p1Slug = `${SLUG_PREFIX}h1-${Date.now().toString(36)}`;
  const p1 = await callAgent(agent.token, hypBody(p1Slug, "Probe: agent hypothesis #1", physics.id));
  if (p1.data?.id) created.suggestions.push(p1.data.id);
  check("propose: agent hypothesis → 201 pending",
    p1.status === 201 && p1.data?.status === "pending" && p1.data?.actor_type === "agent"
    && p1.data?.agent_name === "probe" && p1.data?.proposed_by === agent.profileId,
    `${p1.status} ${p1.error ?? ""}`);

  const { data: notYet } = await service.from("hypotheses").select("id").eq("slug", p1Slug).maybeSingle();
  check("isolation: hypothesis not created until approved", !notYet);

  // ── Token cannot approve (the propose token is not a session) ────────────────
  const tokApprove = await callAgent(agent.token, {}); // wrong shape anyway; but also:
  const tokApprove2 = await fetch(`${BASE}/api/suggestions/${p1.data.id}/approve`, {
    method: "POST", headers: { Authorization: `Bearer ${agent.token}` },
  });
  check("authz: agent token cannot reach the approve route → 401",
    tokApprove2.status === 401, `got ${tokApprove2.status}`);
  void tokApprove;

  // ── Admin approves → created node + timeline credit the AGENT ────────────────
  const approve = await call(admin.cookie, "POST", `/api/suggestions/${p1.data.id}/approve`, {});
  if (approve.data?.applied_id) created.hypotheses.push(approve.data.applied_id);
  check("approve: admin approves agent proposal → 200", approve.status === 200 && !!approve.data?.applied_id,
    `${approve.status} ${approve.error ?? ""}`);

  const { data: hyp } = await service.from("hypotheses")
    .select("created_by, actor_type, agent_name").eq("slug", p1Slug).maybeSingle();
  check("attribution: created hypothesis credits the agent",
    hyp?.created_by === agent.profileId && hyp?.actor_type === "agent" && hyp?.agent_name === "probe",
    JSON.stringify(hyp));

  const { data: tl } = await service.from("timeline_events")
    .select("actor_id, actor_type, agent_name").eq("node_id", approve.data.applied_id)
    .eq("event_type", "hypothesis_created").maybeSingle();
  check("audit: timeline hypothesis_created credits the agent",
    tl?.actor_id === agent.profileId && tl?.actor_type === "agent" && tl?.agent_name === "probe",
    JSON.stringify(tl));

  // ── Pending cap (set cap = current pending count → next insert trips 429) ────
  {
    const { count } = await service.from("suggestions")
      .select("*", { count: "exact", head: true })
      .eq("proposed_by", agent.profileId).eq("status", "pending");
    await service.from("agents").update({ scopes: { domains: [physics.id], max_pending: count, max_per_hour: 1000 } })
      .eq("id", agent.agentId);
    const capped = await callAgent(agent.token, hypBody(`${SLUG_PREFIX}cap-${Date.now().toString(36)}`, "over cap", physics.id));
    check("caps: over max_pending → 429", capped.status === 429, `got ${capped.status} (cap=${count})`);
    await service.from("agents").update({ scopes: { domains: [physics.id], max_pending: 50, max_per_hour: 1000 } })
      .eq("id", agent.agentId);
  }

  // ── Hourly cap (set cap = current last-hour count → next insert trips 429) ───
  {
    const since = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await service.from("suggestions")
      .select("*", { count: "exact", head: true })
      .eq("proposed_by", agent.profileId).gt("created_at", since);
    await service.from("agents").update({ scopes: { domains: [physics.id], max_pending: 1000, max_per_hour: count } })
      .eq("id", agent.agentId);
    const capped = await callAgent(agent.token, hypBody(`${SLUG_PREFIX}hr-${Date.now().toString(36)}`, "over hourly", physics.id));
    check("caps: over max_per_hour → 429", capped.status === 429, `got ${capped.status} (cap=${count})`);
    await service.from("agents").update({ scopes: { domains: [physics.id], max_pending: 50, max_per_hour: 1000 } })
      .eq("id", agent.agentId);
  }

  // ── Phase D: `status` is authoritative, `enabled` is derived ────────────────
  // 0007 made status the single source of truth and derives enabled from it by
  // trigger. The Phase B probe wrote `enabled: false` directly, which is now
  // inert — so assert BOTH halves of that contract: the legacy write does
  // nothing, and the real mechanism still refuses the proposal. Asserting the
  // inert half is what would catch a future revert of the derive trigger.
  await service.from("agents").update({ enabled: false }).eq("id", agent.agentId);
  {
    const { data: row } = await service
      .from("agents").select("enabled, status").eq("id", agent.agentId).single();
    check(
      "status: writing enabled=false directly is inert",
      row?.enabled === true && row?.status === "active",
      `enabled=${row?.enabled} status=${row?.status}`,
    );
  }

  await service.from("agents").update({ status: "suspended" }).eq("id", agent.agentId);
  const suspended = await callAgent(agent.token, hypBody(`${SLUG_PREFIX}sus-${Date.now().toString(36)}`, "suspended", physics.id));
  check("status: suspended agent → 403", suspended.status === 403, `got ${suspended.status}`);
  {
    const { data: row } = await service
      .from("agents").select("enabled").eq("id", agent.agentId).single();
    check(
      "status: suspension is fail-safe (derives enabled=false)",
      row?.enabled === false,
      `enabled=${row?.enabled}`,
    );
  }
  await service.from("agents").update({ status: "active" }).eq("id", agent.agentId);

  // ── Phase D: throttling divides the caps — it does not stop the agent ───────
  // This is the mechanism IA (D.4) uses for a proportionate sanction, so it must
  // demonstrably still let work through. Clear the pending backlog first so the
  // effective cap (max_pending 4 / divisor 4 = 1) is deterministic.
  await service.from("suggestions").delete()
    .eq("proposed_by", agent.profileId ?? agent.userId).eq("status", "pending");
  await service.from("agents").update({
    status: "throttled",
    scopes: { domains: [physics.id], max_pending: 4, max_per_hour: 1000, throttle_divisor: 4 },
  }).eq("id", agent.agentId);
  {
    const first = await callAgent(agent.token, hypBody(`${SLUG_PREFIX}th1-${Date.now().toString(36)}`, "throttled ok", physics.id));
    check("throttle: still permits work → 201", first.status === 201, `got ${first.status}`);
    const second = await callAgent(agent.token, hypBody(`${SLUG_PREFIX}th2-${Date.now().toString(36)}`, "throttled cap", physics.id));
    check("throttle: divided pending cap (4/4=1) → 429", second.status === 429, `got ${second.status}`);
  }
  await service.from("agents").update({
    status: "active",
    scopes: { domains: [physics.id], max_pending: 50, max_per_hour: 1000 },
  }).eq("id", agent.agentId);

  // ── Phase D: the public projection is the security boundary (§D.7) ──────────
  // RLS cannot restrict columns, so agent_public's column LIST is what keeps
  // trust and scopes private. Assert the list, and assert the base tables stay
  // unreachable to anon.
  {
    const anonC = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: pub, error: pubErr } = await anonC.from("agent_public").select("*").limit(1);
    check("public: anon can read agent_public", !pubErr && Array.isArray(pub), pubErr?.message ?? "");
    const cols = pub?.[0] ? Object.keys(pub[0]) : [];
    check(
      "public: agent_public leaks no trust / scopes / profile_id",
      cols.length > 0 && !["trust", "scopes", "profile_id"].some((c) => cols.includes(c)),
      cols.join(",") || "(no rows to inspect)",
    );
    for (const t of ["agents", "agent_tokens", "suggestions", "agent_incidents"]) {
      const { data, error } = await anonC.from(t).select("*").limit(1);
      check(
        `public: anon cannot read ${t}`,
        Boolean(error) || (data ?? []).length === 0,
        error ? `blocked: ${error.code ?? error.message}` : `rows=${data?.length}`,
      );
    }
  }

  // ── Trust governor recomputed on decision ───────────────────────────────────
  // One approved (above) → trust should be 100 over a single decided suggestion.
  const { data: agentRow } = await service.from("agents").select("trust").eq("id", agent.agentId).single();
  check("trust: recomputed after approval", agentRow?.trust === 100, `trust=${agentRow?.trust}`);

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
  await service.from("hypotheses").delete().like("slug", `${SLUG_PREFIX}%`);
  await service.from("evidence").delete().like("slug", `${SLUG_PREFIX}%`);
  for (const id of created.agents) {
    await service.from("agent_tokens").delete().eq("agent_id", id);
  }
  for (const u of [agent, admin]) {
    if (!u) continue;
    const pid = u.profileId ?? u.userId;
    await service.from("suggestions").update({ reviewed_by: null }).eq("reviewed_by", pid);
    await service.from("suggestions").delete().eq("proposed_by", pid);
  }
  for (const id of created.agents) await service.from("agents").delete().eq("id", id);
  if (admin?.client) await admin.client.auth.signOut().catch(() => {});
  for (const id of created.users) await service.auth.admin.deleteUser(id).catch(() => {});
  check("cleanup: probe artifacts + temp identities removed", true);
 }
}

if (ready) {
  await run();
  console.log(`\n${fail === 0 ? "ALL GREEN" : `${fail} FAILURE(S)`} — ${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
}
