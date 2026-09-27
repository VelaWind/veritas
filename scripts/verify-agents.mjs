// End-to-end verification of the Phase B agent layer against the live DB, through
// the real HTTP routes (requireAgent → /api/agent/suggestions → enforce_agent_quota
// trigger → suggestions → apply_suggestion → epistemic constraints + audit
// triggers). Proves the B.0 invariant and the B.2 caps:
//
//   agent proposes → lands pending (credited to the agent) → token cannot approve
//   → admin approves → created node + timeline credit the AGENT → caps enforced
//   (pending cap, hourly cap, domain scope) → bad tokens / disabled agent rejected.
//
// It has since grown Phase D blocks: the skeptic lane and citation verifier
// (0008), the public agent projection (0007), and the council schema (0010) —
// the last of these covering the three D.9 assertions that do not need the
// council runner to exist.
//
// Requires migrations 0005 + 0006 applied and a dev/prod server running
// (BASE_URL, default http://localhost:3210). If the agents table is missing it
// reports BLOCKED (exit 2) rather than a failure. Provisions a temp admin + a
// temp agent, then removes every artifact.
import { readFileSync } from "node:fs";
import { randomBytes, createHash, randomUUID } from "node:crypto";

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

// `kind` defaults to 'research' so every existing call site keeps the lane it
// was written for. §D.4's assertions need an `internal_affairs` agent, and kind
// is what the sanction route gates on, so it has to be settable here.
async function provisionAgent(name, scopes, kind = "research") {
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
    .upsert({ name, profile_id: userId, enabled: true, status: "active", scopes, kind }, { onConflict: "name" })
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

const PROBE_CRITIQUE = {
  critic_name: "skeptic",
  verdict: "weak_assumption",
  body: "Probe critique from verify-agents.mjs: the stated assumption is unjustified.",
  findings: ["The probe assumption is marked unjustified."],
};

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
  // Phase D §D.2: the probe agent is kind='research', and a research proposal
  // without a skeptic critique is refused at the route — so the harness now
  // carries one, exactly as the real runner does. The refusal itself is
  // asserted separately below.
  critique: PROBE_CRITIQUE,
});

const created = { hypotheses: [], evidence: [], sources: [], suggestions: [], agents: [], users: [], councils: [] };
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

  // ── Phase D §D.2: the skeptic lane is mandatory and powerless ──────────────
  // Two halves of one promise. It must be impossible to get a research proposal
  // into the queue WITHOUT an objection attached, and impossible for that
  // objection to decide anything.
  {
    const noCritique = { ...hypBody(`${SLUG_PREFIX}nc-${Date.now().toString(36)}`, "uncritiqued", physics.id) };
    delete noCritique.critique;
    const res = await callAgent(agent.token, noCritique);
    check("skeptic: research proposal without a critique → 422", res.status === 422, `got ${res.status}`);
  }

  {
    const slug = `${SLUG_PREFIX}crit-${Date.now().toString(36)}`;
    const res = await callAgent(agent.token, hypBody(slug, "critiqued", physics.id));
    check("skeptic: proposal + critique land together → 201", res.status === 201, `got ${res.status}`);
    const sid = res.data?.id;

    const { data: crit } = await service
      .from("suggestion_critiques").select("verdict, body, critic_name").eq("suggestion_id", sid);
    check(
      "skeptic: critique stored with the proposal",
      (crit ?? []).length === 1 && crit[0].verdict === "weak_assumption",
      `rows=${crit?.length} verdict=${crit?.[0]?.verdict}`,
    );

    // The blocking test: a maximally hostile critique must move nothing.
    await service.from("suggestion_critiques").update({
      verdict: "confidence_overstated",
      body: "This claim is entirely unsupported and should not be accepted.",
    }).eq("suggestion_id", sid);
    const { data: after } = await service
      .from("suggestions").select("status").eq("id", sid).single();
    check(
      "skeptic: a hostile critique does NOT change the proposal's status",
      after?.status === "pending",
      `status=${after?.status}`,
    );

    // And a 'sound' verdict must not fast-track it either — there is no
    // auto-approve in this codebase and the skeptic does not create one.
    await service.from("suggestion_critiques").update({ verdict: "sound" }).eq("suggestion_id", sid);
    const { data: after2 } = await service
      .from("suggestions").select("status").eq("id", sid).single();
    check(
      "skeptic: a 'sound' verdict does NOT approve anything",
      after2?.status === "pending",
      `status=${after2?.status}`,
    );
  }

  // ── Phase D §D.5a: the SERVER decides what a citation resolves to ──────────
  // The agent posts a citation string and never a verdict, so a compromised
  // runner cannot stamp its own references verified.
  {
    const res = await fetch(`${BASE}/api/agent/citations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${agent.token}` },
      body: JSON.stringify({
        citations: [
          { citation: "https://doi.org/10.1038/nature12373", claimed_title: "" },
          { citation: "A work that does not exist, Nobody, 1899", claimed_title: "A work that does not exist" },
        ],
      }),
    });
    const json = await res.json().catch(() => null);
    const out = json?.data ?? [];
    check("citations: verifier route resolves server-side → 200", res.status === 200, `got ${res.status}`);
    check(
      "citations: a real DOI resolves to verified",
      out[0]?.status === "verified",
      `status=${out[0]?.status} title=${out[0]?.resolved_title ?? "—"}`,
    );
    check(
      "citations: a fabricated reference is unresolved, not rejected",
      out[1]?.status === "unresolved",
      `status=${out[1]?.status}`,
    );
    const { data: anonRead } = await createClient(URL_, ANON, {
      auth: { persistSession: false, autoRefreshToken: false },
    }).from("citation_checks").select("citation_key").limit(1);
    check("citations: checks are publicly readable", (anonRead ?? []).length >= 1, `rows=${anonRead?.length}`);
  }

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

  // ── Phase D stage 3: the council schema (0010) ──────────────────────────────
  // The three D.9 assertions that do not need the council runner. The third is
  // the one that matters: it is the only proof that the deviation-4 shape is
  // ENFORCED rather than merely intended.
  {
    const anonC = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });

    // Two probe suggestions, written as a HUMAN so enforce_agent_quota returns
    // before any cap applies, and differing ONLY in target_type — that single
    // difference is the whole negative control.
    const mkSuggestion = async (targetType) => {
      const { data, error } = await service.from("suggestions").insert({
        target_type: targetType,
        operation: "create",
        payload: {},
        rationale: `${SLUG_PREFIX}council-probe`,
        proposed_by: admin.userId,
        actor_type: "human",
      }).select("id").single();
      if (error) throw new Error(`probe suggestion (${targetType}): ${error.message}`);
      created.suggestions.push(data.id);
      return data.id;
    };
    const sHyp = await mkSuggestion("hypothesis");
    const sEvid = await mkSuggestion("evidence");

    // subject_id deliberately carries no FK (0010: the subject is polymorphic),
    // so a probe uuid is legitimate here rather than a shortcut around one.
    const subjectId = created.hypotheses[0] ?? randomUUID();
    const mkCouncil = (suggestionId) => ({
      subject_type: "hypothesis",
      subject_id: subjectId,
      subject_slug: `${SLUG_PREFIX}council-probe`,
      subject_title: "probe",
      status: "running",
      model: "probe",
      suggestion_id: suggestionId,
    });

    // (3) The trigger must DISCRIMINATE, so both halves are asserted: accept the
    // hypothesis-targeted link, reject the evidence-targeted one with 23514.
    // Asserting only the rejection would pass just as well if the trigger
    // rejected everything, which would be a different bug wearing this one's
    // result.
    const { data: goodC, error: goodErr } =
      await service.from("councils").insert(mkCouncil(sHyp)).select("id").single();
    if (goodC?.id) created.councils.push(goodC.id);
    const { data: badC, error: badErr } =
      await service.from("councils").insert(mkCouncil(sEvid)).select("id").single();
    if (badC?.id) created.councils.push(badC.id);      // only reachable if the shape is NOT enforced
    check(
      "council: verdict-shape trigger enforces the deviation-4 shape (23514)",
      !goodErr && Boolean(goodC?.id) && badErr?.code === "23514",
      `hypothesis-link=${goodErr ? `REJECTED ${goodErr.code}` : "accepted"}, ` +
        `evidence-link=${badErr ? `rejected ${badErr.code}` : "ACCEPTED — shape not enforced"}`,
    );

    // A real turn, so the read assertion below proves a KNOWN row is reachable
    // rather than proving that an empty table is not an error.
    let turnId = null;
    if (goodC?.id) {
      const { data: t } = await service.from("council_turns").insert({
        council_id: goodC.id, round: 1, seq: 1, role: "advocate",
        agent_name: "probe", content: "probe", reasoning: "probe",
      }).select("id").single();
      turnId = t?.id ?? null;
    }

    // (1) The live counterpart to 0010's guard block. Since 0009, a new table
    // inherits NO anon grant, so this is what proves the explicit grants landed.
    // It reads the probe rows BACK BY ID: an empty result would not distinguish
    // "readable but empty" from "readable and denied", and the 0002 failure is
    // exactly the one that looks like an empty success.
    const { data: cRead, error: cErr } =
      await anonC.from("councils").select("id").eq("id", goodC?.id ?? randomUUID());
    const { data: tRead, error: tErr } =
      await anonC.from("council_turns").select("id").eq("id", turnId ?? randomUUID());
    check(
      "public: anon can read councils and council_turns",
      !cErr && !tErr && (cRead ?? []).length === 1 && (tRead ?? []).length === 1,
      cErr?.code ?? tErr?.code ?? `councils=${cRead?.length}, council_turns=${tRead?.length}`,
    );

    // (2) Read-only means read-only: anon's grant is SELECT alone, and the
    // admin-write policy stands behind it.
    const { data: wcData, error: wc } = await anonC.from("councils").insert(mkCouncil(null)).select("id");
    const { data: wtData, error: wt } = await anonC.from("council_turns").insert({
      council_id: goodC?.id ?? randomUUID(), round: 9, seq: 9, role: "advocate", content: "probe",
    }).select("id");
    for (const row of wcData ?? []) created.councils.push(row.id);   // only if the write got through
    check(
      "public: anon cannot write councils or council_turns",
      Boolean(wc) && Boolean(wt),
      `councils=${wc ? `blocked ${wc.code}` : "INSERTED"}, ` +
        `council_turns=${wt ? `blocked ${wt.code}` : "INSERTED"}`,
    );
    if ((wtData ?? []).length) await service.from("council_turns").delete().eq("id", wtData[0].id);
  }

  // ── Trust governor recomputed on decision ───────────────────────────────────
  // One approved (above) → trust should be 100 over a single decided suggestion.
  const { data: agentRow } = await service.from("agents").select("trust").eq("id", agent.agentId).single();
  check("trust: recomputed after approval", agentRow?.trust === 100, `trust=${agentRow?.trust}`);

  // ── §D.4 / D.9 — Internal Affairs: the sanction route and the auditor ───────
  //
  // The powers live in two places by design, and each assertion below says which
  // half it is testing. `ia_apply_sanction` enforces WHAT a sanction may be; it
  // runs as service_role and cannot see which token authenticated, so the route
  // enforces WHO may ask. Testing only the function would leave the route
  // untested and vice versa — and the route half is the one with no database
  // constraint standing behind it.
  {
    const ia = await provisionAgent(
      "ia-probe",
      { domains: [], max_pending: 50, max_per_hour: 1000 },
      "internal_affairs",
    );
    created.users.push(ia.profileId);
    created.agents.push(ia.agentId);

    const sanction = (token, body) =>
      fetch(`${BASE}/api/agent/sanction`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      }).then(async (r) => ({ status: r.status, ...((await r.json().catch(() => ({}))) ?? {}) }));

    const statusOf = async (id) => {
      const { data } = await service.from("agents").select("status, enabled").eq("id", id).single();
      return data ?? {};
    };
    const auditCount = async (name) => {
      const { count } = await service
        .from("agent_audits")
        .select("id", { count: "exact", head: true })
        .eq("agent_name", name);
      return count ?? 0;
    };

    check("D.4 provision: internal_affairs probe agent (kind set, token minted)", Boolean(ia.token));

    // (1) THE ROUTE'S HALF. A VALID token for a NON-IA agent must be refused
    // here, before the database. `probe` is kind='research' and its token is
    // live — it proposed successfully earlier in this run — so a refusal cannot
    // be attributed to the credential. And the refusal must be total: not a
    // sanction that fails later, but one that never reaches the function. Both
    // consequences are asserted, not just the status code.
    const beforeAudits = await auditCount(ia.name);
    const wrongKind = await sanction(agent.token, {
      agent_name: ia.name, action: "suspend", reason: "A research agent attempting a sanction.",
    });
    const afterWrongKind = await statusOf(ia.agentId);
    // The status code alone is not enough. requireAgent ALSO answers 403 for a
    // disabled agent, and `probe` has been suspended and reinstated earlier in
    // this run — so a 403 here could mean "the capability gate worked" or "the
    // probe agent was left disabled by an earlier block", and those are not the
    // same result. The message disambiguates: the capability refusal names the
    // kind, the credential refusal says "is disabled".
    check(
      "D.4 route: a valid NON-IA token is refused a sanction → 403, for the KIND and not the credential",
      wrongKind.status === 403 && /internal_affairs capability/.test(wrongKind.error ?? ""),
      `got ${wrongKind.status} — ${wrongKind.error ?? ""}`,
    );
    check(
      "D.4 route: …and nothing reached the database — no status change, no audit row",
      afterWrongKind.status === "active" && (await auditCount(ia.name)) === beforeAudits,
      `status=${afterWrongKind.status}, audits ${beforeAudits} → ${await auditCount(ia.name)}`,
    );

    // (2) D.9 #9, first half — THE AUDITOR IS NOT EXEMPT. IA sanctions ITSELF,
    // through the real route, with its own token. Self-suspension is fail-safe:
    // it stops work and can corrupt nothing, which is exactly why it is allowed.
    const selfSuspend = await sanction(ia.token, {
      agent_name: ia.name, action: "suspend", reason: "D.9 #9: the auditor suspending itself.",
    });
    const afterSelf = await statusOf(ia.agentId);
    check(
      "D.9 #9: IA may suspend ITSELF through its own route → 200, status suspended",
      selfSuspend.status === 200 && afterSelf.status === "suspended",
      `got ${selfSuspend.status}, status=${afterSelf.status} — ${selfSuspend.error ?? ""}`,
    );
    // 0007 derives `enabled` from `status`, and the quota trigger reads `enabled`.
    // That derivation is what makes suspension fail-safe rather than advisory.
    check(
      "D.9 #9: …and suspension derived enabled=false, which is what stops the work",
      afterSelf.enabled === false,
      `enabled=${afterSelf.enabled}`,
    );
    check(
      "D.9 #9: …and the sanction recorded its own audit row with the transition",
      await (async () => {
        const { data } = await service
          .from("agent_audits")
          .select("severity, actions_taken, findings, report")
          .eq("agent_name", ia.name)
          .order("run_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const act = Array.isArray(data?.actions_taken) ? data.actions_taken[0] : null;
        return (
          data?.severity === "critical" &&
          act?.action === "suspend" &&
          act?.from_status === "active" &&
          act?.to_status === "suspended" &&
          data?.report === null
        );
      })(),
      "expected severity critical, actions_taken[0] active→suspend, report null",
    );

    // (3) D.9 #9, second half — IA CANNOT UN-SUSPEND ITSELF, asserted at every
    // layer that could conceivably express it.
    //
    // (a) Its own token is now dead. Suspension derived enabled=false, and
    //     requireAgent refuses a disabled agent — so a self-suspended auditor
    //     cannot even reach the route to argue. Self-suspension is self-disarming.
    const selfUnsuspend = await sanction(ia.token, {
      agent_name: ia.name, action: "throttle", reason: "Attempting to walk it back.",
    });
    check(
      "D.9 #9: a self-suspended IA cannot reach its own route at all → 403 (token disabled)",
      selfUnsuspend.status === 403,
      `got ${selfUnsuspend.status} — ${selfUnsuspend.error ?? ""}`,
    );

    // (b) And the transition does not exist in the function either, so this is
    //     not merely gated by a dead token. Called with the SERVICE ROLE — the
    //     widest credential in the system, wider than any route holds — which is
    //     the point: 0011 says reinstatement is "a transition it cannot express",
    //     and a permission check would be satisfiable by a big enough key.
    const { error: reinstateErr } = await service.rpc("ia_apply_sanction", {
      p_agent_name: ia.name, p_action: "reinstate", p_reason: "D.9 #3: attempting reinstatement.",
    });
    check(
      "D.9 #3: ia_apply_sanction('reinstate') raises even for service_role → 22023",
      reinstateErr?.code === "22023",
      `got ${reinstateErr?.code ?? "NO ERROR — REINSTATEMENT SUCCEEDED"}`,
    );

    // (c) Loosening is refused by the same rule that refuses reinstatement:
    //     strictly-more-restrictive. suspended → throttled moves DOWN the ladder.
    const { error: loosenErr } = await service.rpc("ia_apply_sanction", {
      p_agent_name: ia.name, p_action: "throttle", p_reason: "D.9 #3: attempting to loosen a suspension.",
    });
    check(
      "D.9 #3: suspended → throttled is refused as not strictly more restrictive → 23514",
      loosenErr?.code === "23514",
      `got ${loosenErr?.code ?? "NO ERROR — A SANCTION WAS LOOSENED"}`,
    );

    // (4) CLEANUP THAT IS ALSO THE ASSERTION. A suspended IA is a dead auditor:
    // if this probe left it suspended, the roster would be stuck with no working
    // Internal Affairs and nothing in the harness would say so. Reinstatement is
    // admin-only, so it goes through the ADMIN path — an admin's own session,
    // under RLS, not the service role, because service_role would bypass the
    // policy and prove nothing about who is allowed to do this.
    //
    // NOTE ON SCOPE: D.4 specifies reinstatement "via requireAdmin() and a
    // separate route". That route does not exist yet — no admin surface writes
    // agents.status — so what is asserted here is the admin RLS path that does.
    // When the route lands, this assertion should move to it.
    const { error: reinstateAdminErr } = await admin.client
      .from("agents")
      .update({ status: "active" })
      .eq("id", ia.agentId);
    const afterReinstate = await statusOf(ia.agentId);
    check(
      "D.9 #3: an ADMIN can reinstate (status → active, enabled derived back to true)",
      !reinstateAdminErr && afterReinstate.status === "active" && afterReinstate.enabled === true,
      `${reinstateAdminErr?.code ?? ""} status=${afterReinstate.status}, enabled=${afterReinstate.enabled}`,
    );
    // And the auditor is genuinely alive again, not merely green in a column: a
    // malformed body now answers 422 (validation) rather than 403 (disabled),
    // which is only reachable once the token passes auth AND the capability gate.
    const aliveAgain = await sanction(ia.token, { agent_name: ia.name, action: "throttle", reason: "" });
    check(
      "D.9 #3: …and the reinstated IA token passes auth and the capability gate again → 422, not 403",
      aliveAgain.status === 422,
      `got ${aliveAgain.status} — ${aliveAgain.error ?? ""}`,
    );

    // (5) D.9 #3, the route's own refusal of reinstatement. There is no spelling
    // of it to send: the zod enum accepts the same two values the function does,
    // so it is refused at the edge without a database round trip.
    const routeReinstate = await sanction(ia.token, {
      agent_name: ia.name, action: "reinstate", reason: "Reinstating through the route.",
    });
    check(
      "D.9 #3: the route cannot express 'reinstate' either → 422 at the edge",
      routeReinstate.status === 422,
      `got ${routeReinstate.status} — ${routeReinstate.error ?? ""}`,
    );

    // (6) D.9 #4 — IA CANNOT TOUCH KNOWLEDGE. A REAL ASSERTION, not a
    // characterization: red here means something is wrong, so it sits with the
    // D.9 block and carries no [characterization] label. Same distinction as
    // F-07a (a precondition that must hold) against F-12 (an accepted state
    // locked at its current value).
    //
    // This replaces the characterization that stood here for one commit, which
    // locked the 201 the route used to return. AUDIT F-13 is closed by the
    // MAY_PROPOSE allow-list in app/api/agent/suggestions/route.ts.
    //
    // BOTH SIDES, AND THE SECOND SIDE IS NOT OPTIONAL. A gate that rejected
    // everything would satisfy a rejection-only test — which is exactly the
    // mistake 0010's verdict-shape trigger work had to correct: a trigger that
    // raises on all input looks identical to a correct one if nothing asserts the
    // permitted case still passes. So the research lane is asserted to still
    // propose successfully, immediately below.
    const iaPropose = await callAgent(ia.token, hypBody(`${SLUG_PREFIX}ia-knowledge`, "IA knowledge write", physics.id));
    if (iaPropose?.data?.id) created.suggestions.push(iaPropose.data.id);   // only if the gate failed
    // Message-checked for the same reason as the sanction gate above: IA was
    // suspended and reinstated a few assertions ago, and a disabled agent also
    // answers 403. "does not propose" is the allow-list's refusal; "is disabled"
    // would be the credential's, and passing on that would be passing by accident.
    check(
      "D.9 #4: an IA token is refused at the propose route → 403 for the KIND (AUDIT F-13 closed)",
      iaPropose.status === 403 && /does not propose/.test(iaPropose.error ?? ""),
      `got ${iaPropose.status}${iaPropose.status === 201 ? " — IA PROPOSED SUCCESSFULLY; the allow-list is not holding" : ""} — ${iaPropose.error ?? ""}`,
    );
    // …and nothing landed. A 403 that still wrote a row would be worse than no
    // gate, because the status code would say it had not.
    const { count: iaRows } = await service
      .from("suggestions")
      .select("id", { count: "exact", head: true })
      .eq("agent_name", ia.name);
    check(
      "D.9 #4: …and no suggestion row exists for the IA agent at all",
      (iaRows ?? 0) === 0,
      `${iaRows} row(s) attributed to ${ia.name}`,
    );

    // THE OTHER SIDE OF THE ALLOW-LIST. `probe` is kind='research', on the list,
    // and must still get through. Its earlier proposals in this run predate the
    // gate's code path being exercised with a fresh request, so this re-asserts it
    // after the IA refusal rather than relying on an earlier success.
    const researchStillWorks = await callAgent(
      agent.token,
      hypBody(`${SLUG_PREFIX}gate-research`, "Research lane still proposes", physics.id),
    );
    if (researchStillWorks?.data?.id) created.suggestions.push(researchStillWorks.data.id);
    check(
      "D.9 #4: …while a research token still proposes → 201 (the gate allows, it does not just reject)",
      researchStillWorks.status === 201,
      `got ${researchStillWorks.status} — ${researchStillWorks.error ?? ""}`,
    );

    // IT IS AN ALLOW-LIST, AND THAT IS ASSERTED RATHER THAN ASSUMED. Everything
    // above is equally consistent with a deny-list that names `internal_affairs`
    // — which is the thing F-13 was explicitly NOT closed with, because a
    // deny-list silently admits every agent_kind added after it. Two flips of the
    // probe agent's registry kind separate the two designs:
    //
    //   `verifier`  — a real kind that is NOT on the list and is NOT IA. A
    //                 deny-list would let it through. (In production it holds no
    //                 token at all, which is why this has to be provoked rather
    //                 than observed: "cannot authenticate" and "would be allowed
    //                 if it could" are different facts, and only one is safe.)
    //   `council`   — the list's second entry, which nothing else in this suite
    //                 exercises because the council identity is not seeded yet.
    //                 It is on the list ahead of need, so the need is simulated.
    for (const [kind, expected, why] of [
      ["verifier", 403, "a kind that is neither research, council, nor IA is refused — allow-list, not deny-list"],
      ["council", 201, "the list's second entry proposes, so stage 3's wiring will not hit this gate"],
    ]) {
      await service.from("agents").update({ kind }).eq("id", ia.agentId);
      const res = await callAgent(
        ia.token,
        hypBody(`${SLUG_PREFIX}gate-${kind}`, `Gate probe: ${kind}`, physics.id),
      );
      if (res?.data?.id) created.suggestions.push(res.data.id);
      check(
        `D.9 #4: kind='${kind}' → ${expected} (${why})`,
        res.status === expected,
        `got ${res.status} — ${res.error ?? ""}`,
      );
    }
    // Back to what it was provisioned as, so the cleanup block and any later
    // reader see the agent this probe claimed to be.
    await service.from("agents").update({ kind: "internal_affairs" }).eq("id", ia.agentId);
  }

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
  // Councils before suggestions: council_turns cascade from councils, and the
  // suggestion FK is `on delete set null`, so a leftover council would survive
  // its probe suggestion and sit in a PUBLIC table pointing at nothing.
  for (const id of created.councils) await service.from("councils").delete().eq("id", id);
  await service.from("councils").delete().like("subject_slug", `${SLUG_PREFIX}%`);
  await service.from("hypotheses").delete().like("slug", `${SLUG_PREFIX}%`);
  await service.from("evidence").delete().like("slug", `${SLUG_PREFIX}%`);
  for (const id of created.agents) {
    await service.from("agent_tokens").delete().eq("agent_id", id);
  }
  // Every provisioned identity, not a hard-coded pair: the IA probe proposes too
  // (the D.9 #4 characterization), and naming agents individually here is how a
  // later probe's rows get left behind.
  for (const pid of created.users) {
    await service.from("suggestions").update({ reviewed_by: null }).eq("reviewed_by", pid);
    await service.from("suggestions").delete().eq("proposed_by", pid);
  }
  // agent_audits BEFORE agents, and by name rather than by id: agent_id is
  // `on delete set null` (0011 — deleting an agent must not erase what it was
  // audited for), so a row deleted in the wrong order survives with a null
  // agent_id and its probe name still in an admin-only table, forever.
  const auditNames = ["ia-probe", agent?.name].filter(Boolean);
  for (const n of auditNames) await service.from("agent_audits").delete().eq("agent_name", n);
  for (const id of created.agents) await service.from("agents").delete().eq("id", id);
  if (admin?.client) await admin.client.auth.signOut().catch(() => {});
  for (const id of created.users) await service.auth.admin.deleteUser(id).catch(() => {});
  check("cleanup: probe artifacts + temp identities removed", true);

  // A suspended IA is a dead auditor, and an audit row that outlives its probe
  // agent is an admin-only table slowly filling with test names. Both are silent
  // failures, so both are counted rather than assumed — the reinstatement itself
  // is asserted above, at the point where it happens.
  {
    const { count: leftAudits } = await service
      .from("agent_audits")
      .select("id", { count: "exact", head: true })
      .in("agent_name", auditNames.length ? auditNames : ["ia-probe"]);
    const { count: leftSugg } = await service
      .from("suggestions")
      .select("id", { count: "exact", head: true })
      .in("agent_name", auditNames.length ? auditNames : ["ia-probe"]);
    check(
      "cleanup: agent_audits and suggestions both back to zero for the probe agents",
      (leftAudits ?? 0) === 0 && (leftSugg ?? 0) === 0,
      `agent_audits=${leftAudits}, suggestions=${leftSugg}`,
    );
  }
 }
}

// ── F-07 canary: has migration 0009 been silently reverted? ─────────────────
//
// The `rDxtm` bits anon holds on existing relations are Supabase PLATFORM
// defaults, not ours (AUDIT.md F-07a). The platform authored those default-ACL
// entries once, so the machinery to author them again exists. 0009 removed
// `anon` from the postgres-owned default ACL for public tables. If platform
// tooling re-applies its baseline, that entry returns, every subsequently
// created table is anon-readable again, and nothing else notices — smoke's
// assertions check that public reads still WORK, never that anon's rights
// stayed ABSENT. The regression would surface only when someone adds a private
// table and finds it already public.
//
// WHY IT LIVES HERE AND NOT IN smoke.ts: pg_default_acl is not in a
// PostgREST-exposed schema, so this needs the Management API and therefore
// SUPABASE_ACCESS_TOKEN — a platform-admin credential. `scripts/smoke.ts` must
// stay runnable against production on PUBLIC credentials alone, so a check
// requiring a privileged token belongs in this harness, which already requires
// SUPABASE_SERVICE_ROLE_KEY.
async function f07Canary() {
  console.log("\n── F-07: 0009 default-privilege canary ──");

  let token = process.env.SUPABASE_ACCESS_TOKEN ?? "";
  if (!token) {
    try {
      for (const line of readFileSync(".env.supabase.local", "utf8").split(/\r?\n/)) {
        if (!line || line.startsWith("#") || !line.includes("=")) continue;
        const i = line.indexOf("=");
        if (line.slice(0, i).trim() === "SUPABASE_ACCESS_TOKEN") {
          token = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
        }
      }
    } catch { /* file absent — handled as a failure below, never as a skip */ }
  }
  const ref = URL_ ? new URL(URL_).hostname.split(".")[0] : "";

  // Missing credentials is a FAILURE, not a skip. A canary that quietly does
  // nothing is worse than no canary, because it reads as coverage.
  if (!token || !ref) {
    check(
      "F-07 canary: platform credentials available",
      false,
      "set SUPABASE_ACCESS_TOKEN (or provide .env.supabase.local) — the 0009 canary cannot be skipped silently",
    );
    check("F-07 canary self-test: detector sees an anon= entry where one exists (storage)", false,
      "not run — no platform credentials");
    check("F-07a control: owner detector sees non-postgres-owned relations where they exist (storage)",
      false, "not run — no platform credentials");
    check("F-07a: every relation in public is postgres-owned (the supabase_admin acceptance holds)",
      false, "not run — no platform credentials");
    f12Characterization(null);
    return;
  }

  /**
   * Two facts about `schema`, over ONE round trip, or null if unreachable:
   *   .acl          postgres-owned default ACL for tables
   *   .foreignOwned [{ owner, rels, ownerDefaultAcl }] — relations owned by a
   *                 role OTHER than postgres, grouped by owner, each carrying
   *                 THAT owner's own default ACL for tables in the schema.
   *
   * The second column is why `.acl` alone was never enough. Every assertion in
   * this function filters the default ACL to `defaclrole = 'postgres'`, which is
   * right — postgres is the role `supabase db push` connects as, so its entry is
   * the one that binds for anything a migration creates. But it also means none
   * of them can see any OTHER role's default entry, and AUDIT.md F-07a accepts
   * the `supabase_admin` table default on exactly one ground: that
   * `supabase_admin` owns no relations in `public`. That is a claim about
   * current state, and nothing verified it. The column below does, by watching
   * the PRECONDITION rather than the ACL — the ACL does not change on the day
   * the hazard fires, the owner does.
   *
   * Widened from `= 'supabase_admin'` to `<> 'postgres'` at no extra cost,
   * because 0009's own correctness argument is that postgres creates everything
   * in public. ANY other owner breaks that premise, not only supabase_admin.
   *
   * The scalar subquery costs nothing measurable: the same statement returned in
   * 424ms against 395-440ms for a bare `select 1` over the same endpoint.
   */
  const tableDefaults = async (schema) => {
    const sql =
      "select coalesce(string_agg(d.defaclacl::text, ' '), '') as acl, (" +
      "  select coalesce(json_agg(x order by x.owner), '[]'::json) from (" +
      "    select pg_get_userbyid(c.relowner) as owner," +
      "           string_agg(c.relname, ', ' order by c.relname) as rels," +
      "           (select coalesce(string_agg(d2.defaclacl::text, ' '), '')" +
      "              from pg_default_acl d2" +
      "              join pg_namespace n2 on n2.oid = d2.defaclnamespace" +
      `             where n2.nspname = '${schema}' and d2.defaclobjtype = 'r'` +
      "               and d2.defaclrole = c.relowner) as owner_default_acl" +
      "      from pg_class c join pg_namespace n3 on n3.oid = c.relnamespace" +
      `     where n3.nspname = '${schema}' and c.relkind in ('r','p','v','m','f')` +
      "       and pg_get_userbyid(c.relowner) <> 'postgres'" +
      "     group by c.relowner) x) as foreign_owned " +
      "from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace " +
      `where n.nspname = '${schema}' and d.defaclobjtype = 'r' ` +
      "and pg_get_userbyid(d.defaclrole) = 'postgres'";
    try {
      const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: sql }),
      });
      if (!res.ok) return null;
      const rows = await res.json();
      const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : {};
      return {
        acl: row.acl ?? "",
        foreignOwned: (Array.isArray(row.foreign_owned) ? row.foreign_owned : []).map((r) => ({
          owner: r.owner,
          rels: r.rels ?? "",
          ownerDefaultAcl: r.owner_default_acl ?? "",
        })),
      };
    } catch {
      return null;
    }
  };

  // Self-test FIRST, and it is not decoration. `storage` is a schema this
  // repository has never written to, and its postgres-owned default genuinely
  // contains an `anon=` entry. If the detector cannot see THAT, it cannot see a
  // real regression either, and the assertion below would pass by being blind
  // rather than by being satisfied. This is the negative control, permanently
  // wired in, using existing state — nothing is granted to manufacture it and
  // nothing is left behind.
  const storage = await tableDefaults("storage");
  const storageAcl = storage === null ? null : storage.acl;
  check(
    "F-07 canary self-test: detector sees an anon= entry where one exists (storage)",
    storageAcl !== null && /\banon=/.test(storageAcl),
    storageAcl === null
      ? "Management API unreachable — the canary below is NOT trustworthy"
      : `storage postgres default ACL = ${storageAcl || "(empty)"} — expected an anon= entry; detector may be blind`,
  );

  // The owner detector gets its own control, on the SAME live state and the same
  // round trip — `storage` was already being fetched for the ACL control above,
  // and it qualifies for this one too: its 8 relations are owned by
  // `supabase_storage_admin`, verified against pg_class before this was written
  // rather than assumed. (`auth`, `realtime` and `vault` also qualify; storage
  // was chosen because it is already fetched, so the control costs no query.)
  //
  // If the detector cannot see NON-POSTGRES OWNERS THERE, its empty result for
  // `public` below means nothing — the assertion would be reporting silence, not
  // absence, which is the same trap the anon control exists to catch.
  //
  // storage also demonstrates why the failure detail below must not flatten the
  // two facts: supabase_storage_admin owns 8 relations AND has no default ACL
  // entry of its own, so "owned by another role" is true there while "anon may
  // hold ALL on it" is false. Ownership is the trigger; the consequence depends
  // on that owner's default entry, and only the pair together says anything.
  check(
    "F-07a control: owner detector sees non-postgres-owned relations where they exist (storage)",
    storage !== null && storage.foreignOwned.length > 0,
    storage === null
      ? "Management API unreachable — the F-07a assertion below is NOT trustworthy"
      : "storage reported NO non-postgres-owned relations, but supabase_storage_admin owns 8 — " +
        "the owner detector is blind and the public result below is meaningless",
  );

  const pub = await tableDefaults("public");
  const publicAcl = pub === null ? null : pub.acl;
  check(
    "F-07: postgres default ACL for public tables grants anon nothing (0009 intact)",
    publicAcl !== null && !/\banon=/.test(publicAcl),
    publicAcl === null
      ? "could not read pg_default_acl via the Management API"
      : `found anon in ${publicAcl} — 0009 HAS BEEN REVERTED, every future table in public is anon-readable again`,
  );

  // ── F-07a: the precondition the supabase_admin acceptance rests on ─────────
  //
  // A REAL ASSERTION, not a characterization. Red here means something is wrong:
  // a relation exists in `public` whose creating role is not the one 0009's fix
  // binds to. See AUDIT.md F-07a, "What is NOT watched".
  //
  // Two facts, reported separately and never merged. "Owned by X" is the fact
  // this query establishes. "anon may hold ALL on it" is a SEPARATE claim that
  // depends entirely on X's own default ACL — which may not exist at all. So the
  // detail prints the owner, its relations, and that owner's default entry, and
  // states the anon consequence only where the entry actually carries an anon
  // grant. Same rule as F-12's failure detail: print the evidence, not a verdict.
  const foreign = pub === null ? [] : pub.foreignOwned;
  const report = foreign.map((o) => {
    const anon = rolePrivs(o.ownerDefaultAcl, "anon");
    return (
      `\n    · ${o.owner} owns: ${o.rels}` +
      `\n      ${o.owner}'s default ACL for tables in public: ${o.ownerDefaultAcl || "(no entry)"}` +
      `\n      consequence: ${
        anon === null
          ? "that owner grants anon nothing by default — the ownership is the finding, not an anon exposure"
          : `anon=${anon} on every table that owner creates in public — ` +
            (/a|w|d/.test(anon) ? "WRITE-CAPABLE, and RLS does not restrain TRUNCATE" : "read-level")
      }`
    );
  });
  check(
    "F-07a: every relation in public is postgres-owned (the supabase_admin acceptance holds)",
    pub !== null && foreign.length === 0,
    pub === null
      ? "could not read pg_class via the Management API"
      : `public holds relations owned by ${foreign.length} role(s) other than postgres, so 0009's ` +
        `default-ACL fix does not bind for them and neither canary above can see it:${report.join("")}` +
        "\n    AUDIT.md F-07a accepts the supabase_admin default ONLY because this count was 0. " +
        "Re-read that acceptance before treating this as benign.",
  );

  f12Characterization(publicAcl);
}

// ── F-12 characterization: the authenticated half of that same default ──────
//
// CHARACTERIZATION, NOT A SECOND CANARY. The F-07 assertion above checks for an
// ABSENCE, and red there means a hazard returned. This one is the opposite
// shape. AUDIT.md F-12 records that the postgres-owned default ACL still grants
// `authenticated` all eight privileges on every future table in public, and
// records it as ACCEPTED and not fixed. The grant being PRESENT is therefore the
// expected state, and what follows locks its exact value rather than objecting
// to it.
//
// It fails in EITHER direction, the good one included. If someone closes the
// grant this goes red, and that is intended: red here means "the accepted state
// moved", never "something is exposed". Update AUDIT.md F-12 and this assertion
// together — the same convention as test-sanitize.mjs section 6, which moves
// with F-10, and the same [characterization] label in the output so no one
// reads a failure as a breach.
//
// Why the value and not just the presence: the eight letters are two findings
// wearing one string. `arwd` is OURS — 0001_core.sql:808-809, the counterpart of
// the anon line 0009 revoked — and is closable. `Dxtm` is platform-authored, the
// residual F-07a accepted. A change to either half surfaces here as the same
// failure, which is why the detail prints the whole ACL instead of a verdict.
//
// No new query: it reads the string f07Canary already fetched and, until now,
// only searched for the anon half.
const F12_EXPECTED = "arwdDxtm";

/**
 * Privilege letters `role` holds in a default-ACL string, null if it has no
 * entry at all. Called with literal role names only — `anon`, `authenticated` —
 * so the name is interpolated into the pattern without escaping.
 *
 * null and "" are different answers and both matter: null means the role is
 * absent from the ACL, "" means it is present holding nothing.
 */
const rolePrivs = (acl, role) => {
  const m = new RegExp(`(?:^|[,{])${role}=([^/,}]*)/`).exec(acl ?? "");
  return m ? m[1] : null;
};

/** Privilege letters `authenticated` holds in a default-ACL string, null if absent. */
const authenticatedPrivs = (acl) => rolePrivs(acl, "authenticated");

function f12Characterization(publicAcl) {
  console.log("\n── F-12: the authenticated half — CHARACTERIZATION, not a breach ──");

  // The negative control cannot come from live state the way the anon one does.
  // Every postgres-owned table default in this project reads arwdDxtm, so no
  // relation exists whose authenticated grant DIFFERS, and manufacturing one
  // would mean granting something — which the control above refuses to do on
  // principle. So the control is applied to the comparator rather than to the
  // database: synthetic ACL strings, mutated in each direction that matters,
  // every one of which the comparator must reject. A comparator that cannot
  // tell arwdDxtm from arwd would pass the assertion below by being blind, in
  // exactly the way a detector that cannot see storage's anon= would.
  const shape = (privs) =>
    privs === null
      ? "{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}"
      : `{postgres=arwdDxtm/postgres,authenticated=${privs}/postgres,service_role=arwdDxtm/postgres}`;
  const blind = [];
  if (authenticatedPrivs(shape(F12_EXPECTED)) !== F12_EXPECTED) {
    blind.push(`cannot read ${F12_EXPECTED} back out of a string that carries it`);
  }
  for (const [name, privs] of [
    ["loosened (arwdDxtmU)", "arwdDxtmU"],
    ["closed to the four verbs 0001 grants (arwd)", "arwd"],
    ["closed to the platform residual (Dxtm)", "Dxtm"],
    ["revoked entirely", null],
  ]) {
    if (authenticatedPrivs(shape(privs)) === F12_EXPECTED) blind.push(`misses ${name}`);
  }
  check(
    "F-12 self-test: comparator reads the value back and rejects every mutation of it",
    blind.length === 0,
    `comparator ${blind.join("; ")} — the characterization below would pass by being blind`,
  );

  const privs = authenticatedPrivs(publicAcl);
  check(
    `[characterization] F-12: postgres default ACL grants authenticated exactly ${F12_EXPECTED} on public tables`,
    publicAcl !== null && privs === F12_EXPECTED,
    publicAcl === null
      ? "not run — no platform credentials, or pg_default_acl unreachable via the Management API"
      : privs === null
        ? `authenticated= is ABSENT from ${publicAcl} — the F-12 grant is gone. NOT a breach: if that was deliberate, close F-12 in AUDIT.md and delete this assertion in the same commit.`
        : `authenticated=${privs}, expected ${F12_EXPECTED}, in ${publicAcl} — the ACCEPTED F-12 state moved. NOT a breach in itself; reconcile AUDIT.md F-12 against this value before reading it either way.`,
  );
}

if (ready) {
  await run();
  await f07Canary();
  console.log(`\n${fail === 0 ? "ALL GREEN" : `${fail} FAILURE(S)`} — ${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
}
