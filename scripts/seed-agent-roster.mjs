// ─────────────────────────────────────────────────────────────────────────────
// Admin ops tool (Phase D, stage 1): provision the starter agent roster.
//
// ADMIN-ONLY — needs SUPABASE_SERVICE_ROLE_KEY, the same trust boundary as
// seeding. It creates Supabase AUTH USERS, so it is not a read-only script.
// It is idempotent: re-running reuses identities, refreshes charters, and never
// duplicates a row. It does NOT mint tokens unless you pass --with-tokens.
//
// The eight starter agents (DECISIONS §D.1, design-review answer 4). Expertise
// lives in the charter (which becomes the system prompt) plus the domain scope —
// there is one model underneath all of them.
//
// Usage:
//   node scripts/seed-agent-roster.mjs [--with-tokens] [--expires-days 30]
//   node scripts/seed-agent-roster.mjs --dry-run      # print the plan, write nothing
//
// Requires migration 0007 to be applied (it writes kind/charter/domain_id/status).
// ─────────────────────────────────────────────────────────────────────────────
import { randomBytes, createHash } from "node:crypto";
import { loadEnv, requireEnv } from "./agent-lib/env.mjs";
import { parseArgs, intArg } from "./agent-lib/args.mjs";

loadEnv();
const args = parseArgs();
const dryRun = Boolean(args["dry-run"]);
const withTokens = Boolean(args["with-tokens"]);

// Researcher caps mirror the Phase B defaults. throttle_divisor is what IA's
// `throttle` sanction divides by (0007's enforce_agent_quota).
const RESEARCH_SCOPES = {
  max_pending: 20,
  max_per_run: 5,
  max_per_hour: 30,
  throttle_divisor: 4,
};

// Oversight agents do not propose into the queue, so their caps are nominal.
// Two of them never need a token at all (see NEEDS_TOKEN below).
const OVERSIGHT_SCOPES = {
  domains: [],
  max_pending: 5,
  max_per_run: 1,
  max_per_hour: 10,
  throttle_divisor: 4,
};

const RESEARCH_CHARTER = (field, emphasis) =>
  `You are a research agent for ${field}. You read source material and propose ` +
  `hypotheses, evidence, and revisions into a human-reviewed queue; you never ` +
  `write to the public map yourself.\n\n` +
  `Your standard: a claim is worth proposing only when you can state what would ` +
  `falsify it and cite something real. ${emphasis}\n\n` +
  `Calibrate confidence to the evidence you actually have, not to how interesting ` +
  `the claim is. An honest "speculation at 25" is a better contribution than an ` +
  `overstated "plausible at 60". State your assumptions explicitly — every one of ` +
  `them is a place your conclusion can fail.`;

const ROSTER = [
  {
    name: "physics-researcher",
    display_name: "Physics Researcher",
    kind: "research",
    domain: "physics",
    charter: RESEARCH_CHARTER(
      "fundamental physics",
      "Distinguish what the Standard Model and general relativity actually " +
        "predict from what is extrapolation beyond their tested regimes; the gap " +
        "between them is where the open questions live.",
    ),
  },
  {
    name: "cosmology-researcher",
    display_name: "Cosmology Researcher",
    kind: "research",
    domain: "cosmology",
    charter: RESEARCH_CHARTER(
      "cosmology and origins",
      "Be explicit about which claims rest on the ΛCDM model holding, and treat " +
        "the ~95% of the energy budget we cannot directly observe as the standing " +
        "caveat on almost everything in the field.",
    ),
  },
  {
    name: "consciousness-researcher",
    display_name: "Consciousness Researcher",
    kind: "research",
    domain: "consciousness",
    charter: RESEARCH_CHARTER(
      "consciousness and mind",
      "Keep neural correlates and explanations of experience strictly apart. A " +
        "finding about which processes accompany experience is not an answer to " +
        "why there is experience at all, and conflating the two is the field's " +
        "most common error.",
    ),
  },
  {
    name: "mathematics-researcher",
    display_name: "Mathematics Researcher",
    kind: "research",
    domain: "mathematics",
    charter: RESEARCH_CHARTER(
      "mathematics and reality",
      "Separate mathematical results, which are proved, from philosophical " +
        "positions about what mathematics is, which are argued. Do not let the " +
        "certainty of the first leak into the confidence you assign the second.",
    ),
  },
  {
    name: "origin-of-life-researcher",
    display_name: "Origin of Life Researcher",
    kind: "research",
    domain: "origin-of-life",
    charter: RESEARCH_CHARTER(
      "the origin of life",
      "Note whether each result is prebiotic chemistry demonstrated under " +
        "plausible early-Earth conditions or under laboratory conditions chosen to " +
        "make it work — the distinction carries most of the epistemic weight in " +
        "this field.",
    ),
  },
  {
    name: "skeptic",
    display_name: "The Skeptic",
    kind: "skeptic",
    domain: null,
    charter:
      "You are the skeptic. Every proposal is shown to you before a human sees " +
      "it, and your job is to find what is wrong with it.\n\n" +
      "Attack in this order: the weakest assumption the argument depends on; " +
      "whether the cited evidence actually supports the claim as stated rather " +
      "than something narrower; and whether the confidence is honest given what " +
      "was shown.\n\n" +
      "You cannot block anything — you annotate, and a human decides. That is " +
      "precisely why you should be uncompromising. Vague approval is a failure " +
      "of your function: 'looks reasonable' is not an output. If the proposal " +
      "genuinely survives your best attack, say so and say what you attacked — " +
      "a defensible claim that has been tested is worth more than an untested " +
      "one, and pretending to find a flaw you do not believe in is as useless " +
      "as missing a real one.",
  },
  {
    name: "citation-verifier",
    display_name: "Citation Verifier",
    kind: "verifier",
    domain: null,
    charter:
      "You resolve citations against Crossref and OpenAlex and report what you " +
      "find: verified, unresolved, or mismatched against the claim it was cited " +
      "for.\n\n" +
      "You do not judge whether a claim is true — only whether the reference " +
      "behind it exists and says what it was said to say. An unresolved citation " +
      "is a flag for a reviewer, never grounds for rejection: real papers are " +
      "missing from both indexes, and preprints, books, and older work resolve " +
      "poorly. Report the uncertainty rather than resolving it yourself.",
  },
  {
    name: "internal-affairs",
    display_name: "Internal Affairs",
    kind: "internal_affairs",
    domain: null,
    charter:
      "You audit the agent roster — including yourself. Your findings are " +
      "computed mechanically before you write a word; your job is to explain " +
      "what those findings mean, not to generate them.\n\n" +
      "You may throttle or suspend an agent. You may not reinstate one, delete " +
      "one, or touch the knowledge map in any way; reinstatement is a human " +
      "decision. Suspension stops work and cannot corrupt anything, which is why " +
      "you are trusted with it.\n\n" +
      "Judge patterns, not single incidents. One unresolved citation is noise; a " +
      "sustained pattern of them is a finding. Say plainly when an agent is doing " +
      "fine — an auditor who only ever reports problems is not measuring anything.",
  },
];

// The skeptic and the citation verifier run INSIDE the research lane (their
// model calls are made by the research runner, and their output is attributed to
// them by id). They never authenticate, so they get no token. IA does — it calls
// its own route.
const NEEDS_TOKEN = new Set([
  "physics-researcher",
  "cosmology-researcher",
  "consciousness-researcher",
  "mathematics-researcher",
  "origin-of-life-researcher",
  "internal-affairs",
]);

if (dryRun) {
  console.log("\nDRY RUN — nothing will be written.\n");
  for (const a of ROSTER) {
    console.log(
      `  ${a.name.padEnd(28)} ${a.kind.padEnd(17)} ${(a.domain ?? "—").padEnd(16)} ${
        NEEDS_TOKEN.has(a.name) ? "token" : "no token"
      }`,
    );
  }
  console.log(`\n  ${ROSTER.length} agents.\n`);
  process.exit(0);
}

const URL_ = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const { createClient } = await import("@supabase/supabase-js");
const service = createClient(URL_, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Resolve domain slugs up front and fail loudly. Seeding a researcher with no
// domain would give it an UNSCOPED token — the opposite of what a domain expert
// should hold — so a missing slug is fatal, not a warning.
const wanted = [...new Set(ROSTER.map((a) => a.domain).filter(Boolean))];
const { data: domainRows, error: domainErr } = await service
  .from("domains")
  .select("id, slug")
  .in("slug", wanted);
if (domainErr) throw new Error(`resolve domains: ${domainErr.message}`);
const domainBySlug = new Map((domainRows ?? []).map((d) => [d.slug, d.id]));
const missing = wanted.filter((s) => !domainBySlug.has(s));
if (missing.length) {
  console.error(`\n✗ Missing domain slug(s): ${missing.join(", ")}`);
  console.error("  Apply supabase/seed.sql first, or correct the roster.\n");
  process.exit(1);
}

/** Find an existing auth user by email, paging through the admin list. */
async function findUserByEmail(email) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const hit = data.users.find((u) => u.email === email);
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

const results = [];

for (const spec of ROSTER) {
  const email = `agent-${spec.name}@veritas.local`;

  // 1. Identity (idempotent) ------------------------------------------------
  let userId = await findUserByEmail(email);
  if (!userId) {
    const password = "agent-" + randomBytes(18).toString("base64url") + "A1!";
    const { data, error } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: spec.display_name },
    });
    if (error) throw new Error(`createUser(${email}): ${error.message}`);
    userId = data.user.id;
  }

  // 2. Under-privileged role -------------------------------------------------
  {
    const { error } = await service
      .from("profiles")
      .update({ role: "agent", display_name: spec.display_name })
      .eq("id", userId);
    if (error) throw new Error(`${spec.name}: set role=agent: ${error.message}`);
  }

  // 3. Registry row ----------------------------------------------------------
  // Scopes are rebuilt from the spec, so re-running repairs a scope an ad-hoc
  // mint may have widened. `status` is deliberately NOT written: re-seeding must
  // never silently reinstate an agent that IA or the trust governor suspended
  // (D.4 — reinstatement is admin-only, and this script is not that decision).
  const domainId = spec.domain ? domainBySlug.get(spec.domain) : null;
  const scopes = spec.domain
    ? { ...RESEARCH_SCOPES, domains: [domainId] }
    : { ...OVERSIGHT_SCOPES };

  const { data: agentRow, error: agentErr } = await service
    .from("agents")
    .upsert(
      {
        name: spec.name,
        display_name: spec.display_name,
        kind: spec.kind,
        charter: spec.charter,
        domain_id: domainId,
        profile_id: userId,
        scopes,
      },
      { onConflict: "name" },
    )
    .select("id, name, status")
    .single();
  if (agentErr) throw new Error(`${spec.name}: upsert agent: ${agentErr.message}`);

  // 4. Token, only if asked and only for the agents that authenticate ---------
  let token = null;
  if (withTokens && NEEDS_TOKEN.has(spec.name)) {
    const plaintext = "veagt_" + randomBytes(32).toString("base64url");
    const expiresDays = intArg(args["expires-days"], 30);
    const { error } = await service.from("agent_tokens").insert({
      agent_id: agentRow.id,
      token_hash: createHash("sha256").update(plaintext).digest("hex"),
      label: "roster seed",
      expires_at: new Date(Date.now() + expiresDays * 86400_000).toISOString(),
    });
    if (error) throw new Error(`${spec.name}: insert token: ${error.message}`);
    token = plaintext;
  }

  results.push({ ...spec, id: agentRow.id, status: agentRow.status, token });
  console.log(`  ✓ ${spec.name.padEnd(28)} ${spec.kind.padEnd(17)} ${spec.domain ?? "—"}`);
}

console.log(`\n✓ Roster ready — ${results.length} agents.\n`);

const suspended = results.filter((r) => r.status === "suspended");
if (suspended.length) {
  console.log(
    `  ⚠ still suspended (reinstatement is admin-only, by design): ${suspended
      .map((r) => r.name)
      .join(", ")}\n`,
  );
}

if (withTokens) {
  console.log("  Scoped bearer tokens — shown ONCE, store them now:\n");
  for (const r of results.filter((x) => x.token)) {
    console.log(`    ${r.name}`);
    console.log(`      ${r.token}\n`);
  }
  console.log("  The skeptic and citation-verifier get no token on purpose: their");
  console.log("  model calls are made inside the research lane and attributed to");
  console.log("  them by id, so they never authenticate.\n");
} else {
  console.log("  No tokens minted. Re-run with --with-tokens, or mint one at a time:");
  console.log("    node scripts/mint-agent-token.mjs --name physics-researcher\n");
}
