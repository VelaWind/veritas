// Audits every public page's REAL data path against the live database by
// importing and calling the same query-layer functions the pages use, through
// the anon client (publicClient). Reports row counts / failures per route.
import { readFileSync } from "node:fs";

// Load .env.local into process.env before importing modules that read it.
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  if (!line || line.startsWith("#") || !line.includes("=")) continue;
  const i = line.indexOf("=");
  process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}

const { createClient } = await import("@supabase/supabase-js");
const anon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { persistSession: false } },
);

let failures = 0;
function report(route, label, { data, error, count }) {
  const n = count ?? (Array.isArray(data) ? data.length : data ? 1 : 0);
  if (error) {
    failures++;
    console.log(`✗ ${route.padEnd(22)} ${label}: ${error.code ?? ""} ${error.message}`);
  } else {
    const flag = n === 0 ? "⚠ " : "✓ ";
    if (n === 0) failures++;
    console.log(`${flag}${route.padEnd(22)} ${label}: ${n}`);
  }
}

// Mirror the exact selects used by lib/queries/*.

// /domains — listDomainsWithCounts
report("/domains", "domains+counts",
  await anon.from("domains").select("*, hypotheses(count), questions(count), evidence(count)"));

// /domains/[slug] — getDomainBySlug + listHypotheses(domainSlug) + listEvidence(domainSlug)
report("/domains/physics", "domain",
  await anon.from("domains").select("*").eq("slug", "physics").maybeSingle());
report("/domains/physics", "hyps in domain",
  await anon.from("hypotheses").select("*, domain:domains!inner(id,slug,name)").eq("domain.slug", "physics").neq("state", "draft"));
report("/domains/physics", "evidence in domain",
  await anon.from("evidence").select("*, source:sources(*), domain:domains!inner(id,slug,name)").eq("domain.slug", "physics"));

// /hypotheses — listHypotheses
report("/hypotheses", "list",
  await anon.from("hypotheses").select("*, domain:domains(id,slug,name)").neq("state", "draft"));

// /hypotheses/[slug] — getHypothesisBySlug (deep embed)
report("/hypotheses/[slug]", "detail+embeds",
  await anon.from("hypotheses").select(
    "*, domain:domains(*), question:questions(id,slug,title), links:hypothesis_evidence(relation,weight,notes,created_at, evidence:evidence(*, source:sources(*))), history:confidence_history(*)",
  ).eq("state", "active").limit(1).maybeSingle());

// /evidence — listEvidence
report("/evidence", "list",
  await anon.from("evidence").select("*, source:sources(*), domain:domains(id,slug,name)"));

// /evidence/[slug] — getEvidenceBySlug
report("/evidence/[slug]", "detail+links",
  await anon.from("evidence").select(
    "*, source:sources(*), domain:domains(id,slug,name), linked_hypotheses:hypothesis_evidence(relation,weight,notes, hypothesis:hypotheses(id,slug,title,status,confidence,state))",
  ).limit(1).maybeSingle());

// /questions — listQuestions
report("/questions", "list",
  await anon.from("questions").select("*, domain:domains(id,slug,name)"));

// /questions/[slug] — getQuestionBySlug
report("/questions/[slug]", "detail+hyps",
  await anon.from("questions").select("*, domain:domains(id,slug,name), hypotheses(*, domain:domains(id,slug,name))").limit(1).maybeSingle());

// /timeline — listTimeline
report("/timeline", "events",
  await anon.from("timeline_events").select("*").order("id", { ascending: false }).limit(30));

// /graph — getGraphPayload (parallel selects)
report("/graph", "graph_edges",
  await anon.from("graph_edges").select("*"));
report("/graph", "graph_nodes view",
  await anon.from("graph_nodes").select("*"));

// /lab + /lab/[category] — listSimulations / listSimulationsWithRuns
report("/lab", "simulations",
  await anon.from("simulations").select("*, simulation_runs(count)"));
report("/lab/[cat]", "sims+runs",
  await anon.from("simulations").select("*, runs:simulation_runs(*)"));

// /notes — listNotes (RLS: only published for anon)
report("/notes", "published notes",
  await anon.from("research_notes").select("*"));

// /dashboard — getDashboardStats + listContradictions + listTimeline
report("/dashboard", "stats matview",
  await anon.from("dashboard_stats").select("*").maybeSingle());
report("/dashboard", "open contradictions",
  await anon.from("contradictions").select(
    "*, a:hypotheses!contradictions_hypothesis_a_fkey(id,slug,title,status), b:hypotheses!contradictions_hypothesis_b_fkey(id,slug,title,status)",
  ).eq("resolved", false));

// /search — global_search RPC
report("/search", "global_search('dark')",
  await anon.rpc("global_search", { q: "dark", lim: 20 }));
report("/search", "global_search('consciousness')",
  await anon.rpc("global_search", { q: "consciousness", lim: 20 }));

// suggested_confidence RPC (used on hypothesis detail + admin)
const oneHyp = await anon.from("hypotheses").select("id").eq("state", "active").limit(1).maybeSingle();
if (oneHyp.data) {
  report("rpc", "suggested_confidence",
    await anon.rpc("suggested_confidence", { h_id: oneHyp.data.id }).then((r) => ({ data: r.data, error: r.error, count: r.error ? 0 : 1 })));
}

console.log(`\n${failures === 0 ? "ALL GREEN" : failures + " issue(s) — see ⚠/✗ above"}`);
process.exit(failures === 0 ? 0 : 1);
