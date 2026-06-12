// ─────────────────────────────────────────────────────────────────────────────
// Admin ops tool (Phase B): register an agent and mint a scoped bearer token.
//
// This is an ADMIN-ONLY action — it needs SUPABASE_SERVICE_ROLE_KEY (from
// .env.local), the same trust boundary as seeding/provisioning. It:
//   1. creates (or reuses) the agent's under-privileged Supabase identity,
//   2. sets its profile role to 'agent',
//   3. upserts the `agents` registry row with scopes (domains + caps),
//   4. mints a token, storing only its SHA-256 hash, and prints the plaintext
//      ONCE. Hand that token to the runner via VERITAS_AGENT_TOKEN.
//
// Usage:
//   node scripts/mint-agent-token.mjs --name research-agent \
//     [--domains physics,consciousness] [--max-pending 20] [--max-per-hour 30] \
//     [--max-per-run 5] [--expires-days 30] [--label "laptop runner"]
//
// Re-running with the same --name reuses the identity and mints a fresh token
// (old tokens stay valid until they expire or you revoke them).
// ─────────────────────────────────────────────────────────────────────────────
import { randomBytes, createHash } from "node:crypto";
import { loadEnv, requireEnv } from "./agent-lib/env.mjs";
import { parseArgs, intArg } from "./agent-lib/args.mjs";

loadEnv();
const args = parseArgs();

if (!args.name || args.name === true) {
  console.error("Usage: node scripts/mint-agent-token.mjs --name <agent-name> [--domains a,b] [--max-pending N] [--max-per-hour N] [--max-per-run N] [--expires-days N] [--label '…']");
  process.exit(2);
}

const URL_ = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const { createClient } = await import("@supabase/supabase-js");
const service = createClient(URL_, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const name = String(args.name).trim();
const emailLocal = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const email = `agent-${emailLocal}@veritas.local`;

// 1. Identity ----------------------------------------------------------------
let userId;
{
  const password = "agent-" + randomBytes(18).toString("base64url") + "A1!";
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: name },
  });
  if (error && /already.*registered|exists/i.test(error.message)) {
    const { data: list } = await service.auth.admin.listUsers();
    userId = list.users.find((u) => u.email === email)?.id;
    if (!userId) throw new Error(`Agent user ${email} exists but could not be found.`);
  } else if (error) {
    throw new Error(`createUser(${email}): ${error.message}`);
  } else {
    userId = data.user.id;
  }
}

// 2. Under-privileged role ---------------------------------------------------
{
  const { error } = await service
    .from("profiles")
    .update({ role: "agent", display_name: name })
    .eq("id", userId);
  if (error) throw new Error(`set role=agent: ${error.message}`);
}

// 3. Registry row (scopes) ---------------------------------------------------
let domainIds = [];
if (args.domains && args.domains !== true) {
  const slugs = String(args.domains).split(",").map((s) => s.trim()).filter(Boolean);
  const { data, error } = await service.from("domains").select("id, slug").in("slug", slugs);
  if (error) throw new Error(`resolve domains: ${error.message}`);
  domainIds = (data ?? []).map((d) => d.id);
  const found = new Set((data ?? []).map((d) => d.slug));
  const missing = slugs.filter((s) => !found.has(s));
  if (missing.length) console.warn(`⚠ unknown domain slug(s) ignored: ${missing.join(", ")}`);
}

const scopes = {
  domains: domainIds,
  max_pending: intArg(args["max-pending"], 20),
  max_per_run: intArg(args["max-per-run"], 5),
  max_per_hour: intArg(args["max-per-hour"], 30),
};

let agentId;
{
  const { data, error } = await service
    .from("agents")
    .upsert({ name, profile_id: userId, enabled: true, scopes }, { onConflict: "name" })
    .select("id")
    .single();
  if (error) throw new Error(`upsert agent: ${error.message}`);
  agentId = data.id;
}

// 4. Token -------------------------------------------------------------------
const plaintext = "veagt_" + randomBytes(32).toString("base64url");
const tokenHash = createHash("sha256").update(plaintext).digest("hex");
const expiresDays = intArg(args["expires-days"], 30);
const expiresAt = new Date(Date.now() + expiresDays * 86400_000).toISOString();
{
  const { error } = await service.from("agent_tokens").insert({
    agent_id: agentId,
    token_hash: tokenHash,
    label: args.label && args.label !== true ? String(args.label) : "",
    expires_at: expiresAt,
  });
  if (error) throw new Error(`insert token: ${error.message}`);
}

console.log("\n✓ Agent ready.");
console.log(`  name        : ${name}`);
console.log(`  agent id    : ${agentId}`);
console.log(`  profile id  : ${userId}`);
console.log(`  scopes      : ${JSON.stringify(scopes)}`);
console.log(`  token expires: ${expiresAt}`);
console.log("\n  Scoped bearer token (shown ONCE — store it now):\n");
console.log(`  ${plaintext}\n`);
console.log("  Use it with the runner, e.g.:");
console.log(`    $env:VERITAS_AGENT_TOKEN = "${plaintext}"   # PowerShell`);
console.log(`    export VERITAS_AGENT_TOKEN="${plaintext}"     # bash`);
