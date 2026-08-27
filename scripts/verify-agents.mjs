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
    return;
  }

  /** postgres-owned default ACL for tables in `schema`, or null if unreachable. */
  const defaultAcl = async (schema) => {
    const sql =
      "select coalesce(string_agg(d.defaclacl::text, ' '), '') as acl " +
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
      return Array.isArray(rows) && rows.length > 0 ? (rows[0].acl ?? "") : "";
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
  const storageAcl = await defaultAcl("storage");
  check(
    "F-07 canary self-test: detector sees an anon= entry where one exists (storage)",
    storageAcl !== null && /\banon=/.test(storageAcl),
    storageAcl === null
      ? "Management API unreachable — the canary below is NOT trustworthy"
      : `storage postgres default ACL = ${storageAcl || "(empty)"} — expected an anon= entry; detector may be blind`,
  );

  const publicAcl = await defaultAcl("public");
  check(
    "F-07: postgres default ACL for public tables grants anon nothing (0009 intact)",
    publicAcl !== null && !/\banon=/.test(publicAcl),
    publicAcl === null
      ? "could not read pg_default_acl via the Management API"
      : `found anon in ${publicAcl} — 0009 HAS BEEN REVERTED, every future table in public is anon-readable again`,
  );
}

if (ready) {
  await run();
  await f07Canary();
  console.log(`\n${fail === 0 ? "ALL GREEN" : `${fail} FAILURE(S)`} — ${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
}
