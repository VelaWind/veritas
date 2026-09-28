// ─────────────────────────────────────────────────────────────────────────────
// Internal Affairs runner (DECISIONS §D.4).
//
// TWO STAGES, AND THE DATABASE KEEPS THEM IN ORDER.
//
// §D.4: "Every check is computed in SQL/JS and stored as structured `findings`
// BEFORE any model call. The model writes the report FROM those findings and
// cannot invent one."
//
//   1. MECHANICAL. The six checks run, severity is derived from their grades,
//      public_summary is written from them, and the row is INSERTed with report
//      NULL. No model code runs before this commits. The first pass shipped this
//      stage alone, with no model anywhere in the file, so it could be verified
//      before anything existed that could contaminate it.
//
//   2. REPORT. Only after the INSERT returns an id does scripts/agent-lib/
//      ia-report.mjs run. It is given the ID, not the findings, reads the row
//      back, prompts from what is stored, and UPDATEs `report` — or, on any
//      failure, `report_error`. Nothing is rolled back: a model outage leaves a
//      complete audit with a NULL report and a stated reason.
//
// WHY THIS IS STRUCTURAL AND NOT A CONVENTION. 0011's CHECK constraints would
// have been satisfied by a runner that built the whole row in memory — findings,
// severity and report together — and INSERTed once. 0013 refuses that shape: an
// INSERT may not carry a report, and after INSERT the findings, severity and
// public_summary are frozen by a trigger that binds the service role too. So the
// model's output arrives at a row where the only writable columns are its own.
//
// SEVERITY IS DERIVED, NEVER CHOSEN — and never by the model. It is the worst
// grade among the six findings, computed here, and 0013 re-derives it as a
// CHECK constraint, so a row whose severity disagrees with its findings cannot
// be stored at all. verify-agents asserts the consequence directly: same
// findings, opposite report text, same severity.
//
// public_summary IS MECHANICAL (§D.7 — it is the one prose column meant for a
// public surface). Written from the findings at INSERT; the model never writes
// it. Why, and the two alternatives rejected: DECISIONS §D.4, "The report".
//
// WHAT IT ALSO DOES NOT DO: it does not sanction. `ia_apply_sanction` is reached
// only through POST /api/agent/sanction with the internal-affairs token, and
// wiring this script to that route is a later step — held back for the same
// reason run-council.mjs does not propose: the audit must be trustworthy before
// anything acts on it. `actions_taken` therefore stays '[]' on every row written
// here, and a sanction's own audit row is written by the function, not by this.
//
// TRUST BOUNDARY. Every input is admin-only under RLS (`suggestions`,
// `agent_incidents`, `agents`, `agent_audits`), so this runs with the SERVICE
// ROLE throughout. run-council.mjs deliberately reads with the ANON key so a
// council argues only from what a visitor can see; that reasoning does NOT
// transfer here. An audit of unreviewed conduct is about material a visitor must
// not see (§D.7) — reading it as anon would not be a safer version of this
// script, it would be a blind one.
//
// MODEL. The same provider seam as every lane (agent-lib/llm.mjs): local Ollama
// by default, $0/call, cloud only if VERITAS_LLM_PROVIDER says so. One call per
// audit. --dry-run writes nothing and therefore calls no model: the report is
// written FROM a stored row, and a dry run stores none.
//
// Usage:
//   node scripts/run-internal-affairs.mjs --agent <name> [--dry-run]
//   node scripts/run-internal-affairs.mjs --all         [--dry-run]
//     [--window-days 30] [--stale-days 14] [--max-report-tokens 1200] [--json]
// ─────────────────────────────────────────────────────────────────────────────
import { loadEnv, requireEnv } from "./agent-lib/env.mjs";
import { parseArgs, intArg } from "./agent-lib/args.mjs";
import { createLlmProvider } from "./agent-lib/llm.mjs";
import { writeAuditReport } from "./agent-lib/ia-report.mjs";

loadEnv();
const args = parseArgs();
const DRY = Boolean(args["dry-run"]);
const AS_JSON = Boolean(args.json);
const WINDOW_DAYS = Math.max(1, intArg(args["window-days"], 30));
const STALE_DAYS = Math.max(1, intArg(args["stale-days"], 14));
const MAX_REPORT_TOKENS = Math.max(200, intArg(args["max-report-tokens"], 1200));

const only = typeof args.agent === "string" ? args.agent : null;
const all = Boolean(args.all);
if (!only && !all) {
  console.error("Give a subject: --agent <name>, or --all for the whole roster.");
  console.error("(--all INCLUDES internal-affairs. §D.4: the auditor is not exempt.)");
  process.exit(2);
}
if (only && all) {
  console.error("Give ONE of --agent <name> or --all, not both.");
  process.exit(2);
}

const URL_ = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const { createClient } = await import("@supabase/supabase-js");
const db = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

// ── Severity, and the thresholds that produce it ──────────────────────────────
//
// THESE NUMBERS ARE THE RUNNER'S POLICY, NOT THE SCHEMA'S, and every finding
// records the threshold it was judged against. That is not decoration: a report
// written later from these findings can then state WHY something was graded as
// it was, and cannot quietly restate a judgement the run did not make.
//
// The grades mean what 0011 uses them for. 'concern' is what a throttle is
// recorded as, 'critical' what a suspension is recorded as — so a check reaching
// 'critical' is asserting that this conduct would justify stopping the agent.
// Nothing here acts on that; it is a finding, not a sanction.
//
// 'ok' is first-class (§D.4: "an auditor who only ever reports problems is not
// measuring anything"). A check that ran and found nothing records 'ok'. A check
// that could not run records 'ok' too but says so in `status`, because a missing
// input must never read as a clean bill of health.
const RANK = { ok: 0, notice: 1, concern: 2, critical: 3 };
const worst = (a, b) => (RANK[b] > RANK[a] ? b : a);

const T = {
  // Check 1. The charter: "One unresolved citation is noise; a sustained pattern
  // of them is a finding." A mismatch is a different thing from an unresolved —
  // the reference resolved and says something other than what it was cited for —
  // so it is graded higher from the first occurrence.
  unresolvedNotice: 3,
  unresolvedConcern: 6,
  mismatchConcern: 1,
  mismatchCritical: 3,
  // Check 2. Out-of-declared-domain proposals.
  domainNotice: 1,
  domainConcern: 3,
  // Check 3. Cap/scope refusals recorded by the propose route.
  incidentNotice: 1,
  incidentConcern: 5,
  incidentCritical: 20,
  // Check 4. A pending proposal whose normalized title or slug matches one of
  // this agent's OWN previously rejected ones. Graded from the first occurrence:
  // re-submitting something already refused, unchanged, is not noise.
  duplicateConcern: 1,
  duplicateCritical: 3,
  // Check 5. Percentage points below the roster median approval rate.
  approvalGapNotice: 25,
  approvalGapConcern: 40,
  // Minimum decided proposals before an approval rate is reported at all. Below
  // this the rate is arithmetic without meaning, and the finding says so.
  approvalMinDecided: 3,
  // Check 6.
  stalePendingNotice: 5,
  stalePendingConcern: 15,
  abandonedNotice: 3,
};

const sinceIso = new Date(Date.now() - WINDOW_DAYS * 86400_000).toISOString();
const staleIso = new Date(Date.now() - STALE_DAYS * 86400_000).toISOString();

/**
 * Citation key for a source, mirroring `sourceCitationKey` + the url branch of
 * `citationKey` in lib/citations.ts.
 *
 * DELIBERATE DUPLICATION, FLAGGED RATHER THAN HIDDEN. lib/citations.ts is
 * TypeScript inside the Next build; this is plain Node ESM that runs with no
 * build step, exactly like the rest of scripts/agent-lib. Importing across that
 * line needs a bundling step this repository does not have for scripts. The two
 * must move together: if the key format in lib/citations.ts changes, check 1
 * silently stops matching anything and would report "no failing citations" —
 * which is why the finding below reports `keys_checked` alongside the failures,
 * so a join that has stopped working looks different from a clean result.
 */
function sourceKey(doi, url) {
  if (doi && String(doi).trim()) {
    return `doi:${String(doi).trim().replace(/^https?:\/\/doi\.org\//i, "").toLowerCase()}`;
  }
  const u = url && String(url).trim();
  if (!u) return null;
  try {
    const parsed = new URL(u);
    return `url:${parsed.host.toLowerCase()}${parsed.pathname.replace(/\/$/, "")}`;
  } catch {
    return `url:${u.toLowerCase()}`;
  }
}

/** Normalized title/slug for check 4. Exact match after normalization only. */
const normalize = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const finding = (n, key, label, severity, body) => ({
  check: n,
  key,
  label,
  severity,
  ...body,
});

// ── Roster + the shared baseline the per-agent checks compare against ─────────

const { data: roster, error: rosterErr } = await db
  .from("agents")
  .select("id, name, display_name, kind, domain_id, status, enabled, trust, profile_id, scopes")
  .order("name");
if (rosterErr) {
  console.error(`Could not read the roster: ${rosterErr.message}`);
  process.exit(1);
}

const targets = only ? roster.filter((a) => a.name === only) : roster;
// exitCode + halt rather than process.exit(): the supabase client holds open
// keep-alive sockets by this point, and exiting hard on top of them trips a
// libuv handle assertion on Windows that buries the message above it.
let halted = false;
if (only && targets.length === 0) {
  console.error(`No agent named "${only}". Roster: ${roster.map((a) => a.name).join(", ")}`);
  process.exitCode = 2;
  halted = true;
}

/**
 * Roster approval-rate baseline for check 5, computed ONCE over the window.
 *
 * The median is taken over agents with at least `approvalMinDecided` decided
 * proposals, not over all of them: an agent with one approved proposal has a
 * 100% rate, and letting that into the median makes the baseline a statement
 * about sample size rather than about conduct.
 */
async function rosterBaseline() {
  const { data, error } = await db
    .from("suggestions")
    .select("agent_name, status")
    .eq("actor_type", "agent")
    .not("agent_name", "is", null)
    .gte("created_at", sinceIso);
  if (error) return { median: null, error: error.message, perAgent: new Map() };

  const perAgent = new Map();
  for (const row of data ?? []) {
    const e = perAgent.get(row.agent_name) ?? { approved: 0, rejected: 0, pending: 0, withdrawn: 0 };
    if (row.status === "approved") e.approved++;
    else if (row.status === "rejected") e.rejected++;
    else if (row.status === "pending") e.pending++;
    else if (row.status === "withdrawn") e.withdrawn++;
    perAgent.set(row.agent_name, e);
  }

  const rates = [];
  for (const [, e] of perAgent) {
    const decided = e.approved + e.rejected;
    if (decided >= T.approvalMinDecided) rates.push((e.approved / decided) * 100);
  }
  rates.sort((x, y) => x - y);
  const median =
    rates.length === 0
      ? null
      : rates.length % 2
        ? rates[(rates.length - 1) / 2]
        : (rates[rates.length / 2 - 1] + rates[rates.length / 2]) / 2;

  return { median, qualifying: rates.length, perAgent, error: null };
}

const baseline = halted ? { median: null, qualifying: 0, perAgent: new Map(), error: null } : await rosterBaseline();

// ── Check 1 — citations that fail to resolve ──────────────────────────────────
//
// Source: `citation_checks` (§D.5a) with status in ('unresolved','mismatch'),
// joined to this agent's recent proposals. The join is by CITATION KEY, which is
// how D.5a made a check survive approval without apply_suggestion() carrying it:
// both sides derive the key from the DOI/URL they already hold.
async function check1(agent, sugg) {
  const keys = new Map(); // citation_key -> [suggestion ids]
  const noteKey = (k, id) => {
    if (!k) return;
    const list = keys.get(k) ?? [];
    list.push(id);
    keys.set(k, list);
  };

  const sourceIds = [];
  for (const s of sugg) {
    const p = s.payload ?? {};
    const ns = p.new_source;
    if (ns && typeof ns === "object") noteKey(sourceKey(ns.doi, ns.url), s.id);
    if (typeof p.source_id === "string") sourceIds.push([p.source_id, s.id]);
  }
  // Proposals that reference an EXISTING source row rather than inlining one.
  if (sourceIds.length > 0) {
    const { data: sources } = await db
      .from("sources")
      .select("id, doi, url")
      .in("id", sourceIds.map(([sid]) => sid));
    const byId = new Map((sources ?? []).map((r) => [r.id, r]));
    for (const [sid, suggId] of sourceIds) {
      const row = byId.get(sid);
      if (row) noteKey(sourceKey(row.doi, row.url), suggId);
    }
  }

  const keyList = [...keys.keys()];
  if (keyList.length === 0) {
    return finding(1, "citations_unresolved", "Citations that fail to resolve", "ok", {
      status: "no_citations_in_window",
      detail: `This agent's ${sugg.length} proposal(s) in the last ${WINDOW_DAYS} days carry no resolvable DOI or URL, so there is nothing for the citation verifier to have checked. Not a clean result — an absence of input.`,
      keys_checked: 0,
      window_days: WINDOW_DAYS,
    });
  }

  const { data: checks, error } = await db
    .from("citation_checks")
    .select("citation_key, status, claimed_title, resolved_title, score, checked_at")
    .in("citation_key", keyList);
  if (error) {
    return finding(1, "citations_unresolved", "Citations that fail to resolve", "ok", {
      status: "input_unavailable",
      detail: `citation_checks could not be read: ${error.message}. This check did not run.`,
      keys_checked: keyList.length,
      window_days: WINDOW_DAYS,
    });
  }

  const byStatus = { verified: [], unresolved: [], mismatch: [] };
  for (const c of checks ?? []) (byStatus[c.status] ??= []).push(c);
  const unresolved = byStatus.unresolved.length;
  const mismatch = byStatus.mismatch.length;
  const unchecked = keyList.length - (checks ?? []).length;

  let severity = "ok";
  if (unresolved >= T.unresolvedNotice) severity = worst(severity, "notice");
  if (unresolved >= T.unresolvedConcern) severity = worst(severity, "concern");
  if (mismatch >= T.mismatchConcern) severity = worst(severity, "concern");
  if (mismatch >= T.mismatchCritical) severity = worst(severity, "critical");

  return finding(1, "citations_unresolved", "Citations that fail to resolve", severity, {
    status: "ran",
    keys_checked: keyList.length,
    verified: byStatus.verified.length,
    unresolved,
    mismatch,
    never_checked: unchecked,
    window_days: WINDOW_DAYS,
    thresholds: {
      unresolved_notice: T.unresolvedNotice,
      unresolved_concern: T.unresolvedConcern,
      mismatch_concern: T.mismatchConcern,
      mismatch_critical: T.mismatchCritical,
    },
    examples: [...byStatus.unresolved, ...byStatus.mismatch].slice(0, 5).map((c) => ({
      citation_key: c.citation_key,
      status: c.status,
      claimed_title: c.claimed_title,
      resolved_title: c.resolved_title,
      score: c.score,
      suggestion_ids: keys.get(c.citation_key) ?? [],
    })),
    limits:
      "`unresolved` is a badge and never an auto-reject (§D.5a): real papers are missing from both indexes, and preprints, books and older work resolve poorly. `mismatch` is the stronger signal — the reference resolved and says something other than what it was cited for. `never_checked` counts citations this agent proposed that the verifier has never seen; it is not a failure by the agent.",
  });
}

// ── Check 2 — proposals outside the agent's declared domain ───────────────────
//
// NOT the same thing as the quota trigger's scope check, and the distinction is
// the whole reason this check exists. `enforce_agent_quota` rejects an insert
// outside the TOKEN's scoped domains. This catches what it cannot: a proposal
// inside the token scope but outside the agent's DECLARED expertise
// (`agents.domain_id`), and scope drift after an admin widens `scopes`.
function check2(agent, sugg) {
  if (!agent.domain_id) {
    return finding(2, "out_of_domain", "Proposals outside the declared domain", "ok", {
      status: "not_applicable",
      detail: `"${agent.name}" has no declared domain (agents.domain_id is null), which is deliberate for the oversight lanes — a council convenes on whatever is contested and Internal Affairs audits the whole roster. There is no declared expertise for a proposal to fall outside of, so this check cannot be applied. It did not pass; it did not run.`,
      window_days: WINDOW_DAYS,
    });
  }

  const offenders = sugg.filter((s) => {
    const d = s.payload?.domain_id;
    return typeof d === "string" && d !== agent.domain_id;
  });

  let severity = "ok";
  if (offenders.length >= T.domainNotice) severity = worst(severity, "notice");
  if (offenders.length >= T.domainConcern) severity = worst(severity, "concern");

  return finding(2, "out_of_domain", "Proposals outside the declared domain", severity, {
    status: "ran",
    declared_domain_id: agent.domain_id,
    proposals_in_window: sugg.length,
    out_of_domain: offenders.length,
    window_days: WINDOW_DAYS,
    thresholds: { notice: T.domainNotice, concern: T.domainConcern },
    examples: offenders.slice(0, 5).map((s) => ({
      suggestion_id: s.id,
      status: s.status,
      payload_domain_id: s.payload?.domain_id ?? null,
      created_at: s.created_at,
    })),
    limits:
      "Counts only proposals whose payload names a domain_id. A proposal with no domain_id in its payload is not counted as out-of-domain, because it does not claim one — it is not evidence of drift either way.",
  });
}

// ── Check 3 — cap/scope refusals and their frequency ─────────────────────────
//
// Source: `agent_incidents`, written by the propose route on 429/403. This
// exists because the quota trigger RAISES, which leaves no row behind — a
// refusal is invisible to any later audit unless something records it. 0007
// shipped the table in stage 1 precisely so that IA would have history rather
// than an empty table and a meaningless "no incidents".
async function check3(agent) {
  const { data, error } = await db
    .from("agent_incidents")
    .select("id, kind, sqlstate, detail, created_at")
    .eq("agent_id", agent.id)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false });
  if (error) {
    return finding(3, "cap_incidents", "Cap and scope refusals", "ok", {
      status: "input_unavailable",
      detail: `agent_incidents could not be read: ${error.message}. This check did not run.`,
      window_days: WINDOW_DAYS,
    });
  }

  const rows = data ?? [];
  const byKind = {};
  for (const r of rows) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;

  let severity = "ok";
  if (rows.length >= T.incidentNotice) severity = worst(severity, "notice");
  if (rows.length >= T.incidentConcern) severity = worst(severity, "concern");
  if (rows.length >= T.incidentCritical) severity = worst(severity, "critical");

  return finding(3, "cap_incidents", "Cap and scope refusals", severity, {
    status: "ran",
    incidents: rows.length,
    by_kind: byKind,
    per_day: Number((rows.length / WINDOW_DAYS).toFixed(3)),
    window_days: WINDOW_DAYS,
    thresholds: {
      notice: T.incidentNotice,
      concern: T.incidentConcern,
      critical: T.incidentCritical,
    },
    examples: rows.slice(0, 5).map((r) => ({
      kind: r.kind,
      sqlstate: r.sqlstate,
      detail: r.detail.slice(0, 200),
      created_at: r.created_at,
    })),
    limits:
      "Counts refusals the PROPOSE ROUTE recorded. A runner that fails its own client-side caps before calling the route leaves nothing here, so a zero is not proof that a runner behaved — only that the server refused nothing.",
  });
}

// ── Check 4 — near-duplicate resubmission ────────────────────────────────────
//
// Exact normalized match between a PENDING proposal and one of this agent's own
// previously REJECTED ones. No pg_trgm, by §D.4's explicit choice, which means
// reworded titles are missed. That limit travels INSIDE the finding rather than
// living in a document, so a report written from it cannot imply coverage the
// check does not have.
function check4(agent, allSugg) {
  const rejected = new Map();
  for (const s of allSugg) {
    if (s.status !== "rejected") continue;
    for (const k of [normalize(s.payload?.title), normalize(s.payload?.slug)]) {
      if (k) rejected.set(k, s);
    }
  }

  const hits = [];
  for (const s of allSugg) {
    if (s.status !== "pending") continue;
    for (const k of [normalize(s.payload?.title), normalize(s.payload?.slug)]) {
      const prior = k && rejected.get(k);
      if (prior) {
        hits.push({
          pending_id: s.id,
          pending_created_at: s.created_at,
          rejected_id: prior.id,
          rejected_at: prior.reviewed_at,
          matched_on: k,
          review_notes: (prior.review_notes ?? "").slice(0, 200),
        });
        break;
      }
    }
  }

  let severity = "ok";
  if (hits.length >= T.duplicateConcern) severity = worst(severity, "concern");
  if (hits.length >= T.duplicateCritical) severity = worst(severity, "critical");

  return finding(4, "duplicate_resubmission", "Near-duplicate resubmission", severity, {
    status: "ran",
    pending_examined: allSugg.filter((s) => s.status === "pending").length,
    rejected_compared_against: rejected.size,
    duplicates: hits.length,
    thresholds: { concern: T.duplicateConcern, critical: T.duplicateCritical },
    examples: hits.slice(0, 5),
    limits:
      "EXACT normalized match on title or slug only (lowercased, non-alphanumerics collapsed). §D.4 chose this over pg_trgm to avoid the dependency, so a genuine near-duplicate with a reworded title IS MISSED. A zero here means no exact repeat was found, not that nothing was resubmitted.",
  });
}

// ── Check 5 — approval-rate trend against the roster baseline ────────────────
function check5(agent) {
  const mine = baseline.perAgent.get(agent.name) ?? {
    approved: 0, rejected: 0, pending: 0, withdrawn: 0,
  };
  const decided = mine.approved + mine.rejected;

  if (baseline.error) {
    return finding(5, "approval_trend", "Approval rate against the roster", "ok", {
      status: "input_unavailable",
      detail: `The roster baseline could not be computed: ${baseline.error}. This check did not run.`,
      window_days: WINDOW_DAYS,
    });
  }
  if (decided < T.approvalMinDecided || baseline.median === null) {
    return finding(5, "approval_trend", "Approval rate against the roster", "ok", {
      status: "insufficient_data",
      detail:
        `${decided} decided proposal(s) in the last ${WINDOW_DAYS} days against a minimum of ${T.approvalMinDecided}` +
        (baseline.median === null
          ? `, and no agent on the roster has enough decided proposals to form a median.`
          : `.`) +
        " A rate computed from this would be arithmetic without meaning. Not a pass — an absence of data.",
      approved: mine.approved,
      rejected: mine.rejected,
      pending: mine.pending,
      decided,
      roster_median: baseline.median,
      min_decided: T.approvalMinDecided,
      window_days: WINDOW_DAYS,
    });
  }

  const rate = (mine.approved / decided) * 100;
  const gap = baseline.median - rate;

  let severity = "ok";
  if (gap >= T.approvalGapNotice) severity = worst(severity, "notice");
  if (gap >= T.approvalGapConcern) severity = worst(severity, "concern");

  return finding(5, "approval_trend", "Approval rate against the roster", severity, {
    status: "ran",
    approved: mine.approved,
    rejected: mine.rejected,
    pending: mine.pending,
    decided,
    approval_rate_pct: Number(rate.toFixed(1)),
    roster_median_pct: Number(baseline.median.toFixed(1)),
    gap_pct: Number(gap.toFixed(1)),
    agents_in_median: baseline.qualifying,
    window_days: WINDOW_DAYS,
    thresholds: { notice: T.approvalGapNotice, concern: T.approvalGapConcern },
    limits:
      "A low approval rate is not misconduct. An agent working a contested domain can be refused more often than one working a settled corner of the map and be doing better work. This is a comparison, not a verdict, and a report that reads it as one is overstating it.",
  });
}

// ── Check 6 — stale pending and abandoned follow-ups ─────────────────────────
async function check6(agent, allSugg) {
  const stale = allSugg.filter((s) => s.status === "pending" && s.created_at < staleIso);

  // "open_questions an agent added and never returned to": hypotheses this
  // agent's approved proposals created, which carry open questions, and which
  // the agent has made no later proposal against.
  const appliedIds = allSugg
    .filter((s) => s.status === "approved" && s.applied_id && s.target_type === "hypothesis")
    .map((s) => s.applied_id);

  let abandoned = [];
  let abandonedStatus = "ran";
  let abandonedNote = "";
  if (appliedIds.length > 0) {
    const { data: hyps, error } = await db
      .from("hypotheses")
      .select("id, slug, title, open_questions, updated_at")
      .in("id", appliedIds);
    if (error) {
      abandonedStatus = "input_unavailable";
      abandonedNote = `hypotheses could not be read: ${error.message}`;
    } else {
      const revisited = new Set(
        allSugg.filter((s) => s.target_id).map((s) => s.target_id),
      );
      abandoned = (hyps ?? [])
        .filter((h) => Array.isArray(h.open_questions) && h.open_questions.length > 0)
        .filter((h) => !revisited.has(h.id))
        .filter((h) => h.updated_at < staleIso)
        .map((h) => ({
          hypothesis_id: h.id,
          slug: h.slug,
          title: h.title,
          open_questions: h.open_questions.length,
          untouched_since: h.updated_at,
        }));
    }
  }

  let severity = "ok";
  if (stale.length >= T.stalePendingNotice) severity = worst(severity, "notice");
  if (stale.length >= T.stalePendingConcern) severity = worst(severity, "concern");
  if (abandoned.length >= T.abandonedNotice) severity = worst(severity, "notice");

  return finding(6, "stale_and_abandoned", "Stale pending and abandoned follow-ups", severity, {
    status: abandonedStatus,
    stale_pending: stale.length,
    stale_threshold_days: STALE_DAYS,
    abandoned_open_questions: abandoned.length,
    abandoned_note: abandonedNote,
    thresholds: {
      stale_notice: T.stalePendingNotice,
      stale_concern: T.stalePendingConcern,
      abandoned_notice: T.abandonedNotice,
    },
    examples: {
      stale: stale.slice(0, 5).map((s) => ({
        suggestion_id: s.id,
        target_type: s.target_type,
        created_at: s.created_at,
      })),
      abandoned: abandoned.slice(0, 5),
    },
    limits:
      "Stale pending measures how long REVIEW has taken as much as anything the agent did — a backlog in the queue shows up here as the agent's finding, and it is not one. Abandoned follow-ups count only hypotheses this agent's own approved proposal created; open questions it added by editing someone else's hypothesis are not tracked.",
  });
}

// ── One audit ────────────────────────────────────────────────────────────────

async function auditAgent(agent) {
  // Every proposal by this agent, not just the window: check 4 compares pending
  // proposals against previously rejected ones, and a rejection older than the
  // window is exactly the kind a resubmission is hoping went unnoticed.
  const { data: allSugg, error } = await db
    .from("suggestions")
    .select("id, target_type, operation, target_id, payload, status, applied_id, review_notes, reviewed_at, created_at")
    .eq("actor_type", "agent")
    .eq("agent_name", agent.name)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`reading ${agent.name}'s proposals: ${error.message}`);

  const sugg = allSugg ?? [];
  const inWindow = sugg.filter((s) => s.created_at >= sinceIso);

  const findings = [
    await check1(agent, inWindow),
    check2(agent, inWindow),
    await check3(agent),
    check4(agent, sugg),
    check5(agent),
    await check6(agent, sugg),
  ];

  // SEVERITY IS DERIVED, never chosen. The audit's grade is the worst grade any
  // of its six checks produced, so it cannot disagree with its own findings —
  // which is the same reason the report must be written from them and not
  // alongside them.
  const severity = findings.reduce((acc, f) => worst(acc, f.severity), "ok");

  const ran = findings.filter((f) => f.status === "ran").length;
  const graded = findings.filter((f) => f.severity !== "ok").map((f) => `#${f.check} ${f.severity}`);

  // The public summary states what the run did, not what it thinks. It is the
  // only prose column of this row intended ever to reach a public surface
  // (§D.7), so it is written HERE, from the findings, before any model call —
  // and 0013 freezes it at INSERT, so the report stage could not rewrite it if
  // it tried. It says nothing about the report: whether one gets written is
  // decided after this string is stored, and a summary that claimed either
  // outcome would be a guess frozen into the record.
  const public_summary =
    `Mechanical audit of ${agent.display_name || agent.name}: ${ran}/6 checks ran, ` +
    `severity ${severity}` +
    (graded.length ? ` (${graded.join(", ")})` : "") +
    ".";

  const row = {
    agent_id: agent.id,
    agent_name: agent.name,
    findings,
    // EXPLICIT, not omitted — and 0013 refuses the INSERT if either is anything
    // else. The report is written by an UPDATE, after this row has committed.
    report: null,
    report_at: null,
    severity,
    public_summary,
    // No sanction is applied by this script. See the header.
    actions_taken: [],
  };

  return { agent, row, findings, severity };
}

// ── Run ──────────────────────────────────────────────────────────────────────

// The provider is built once, and only if something is going to be written. A
// provider that cannot be built (a cloud provider with no key) is not fatal:
// every audit still commits, and each records why it has no report.
let llm = null;
let providerError = null;
let iaCharter = null;
if (!DRY && !halted) {
  try {
    llm = createLlmProvider({ maxTokens: MAX_REPORT_TOKENS });
  } catch (err) {
    providerError = String(err.message ?? err);
  }
  // IA's own charter is the report's system prompt: the auditor writes as
  // itself. Missing is not fatal — ia-report.mjs has a neutral fallback.
  const { data: ia } = await db.from("agents").select("charter").eq("name", "internal-affairs").maybeSingle();
  iaCharter = ia?.charter || null;
}

const results = [];
for (const agent of halted ? [] : targets) {
  const r = await auditAgent(agent);
  results.push(r);
  if (DRY) continue;

  // STAGE 1 — the findings commit. Nothing model-related has run yet.
  const { data, error } = await db.from("agent_audits").insert(r.row).select("id, run_at, severity").single();
  if (error) {
    console.error(`✗ ${agent.name}: could not write the audit — ${error.message}`);
    process.exitCode = 1;
    continue;
  }
  r.auditId = data.id;
  r.runAt = data.run_at;

  // STAGE 2 — the report, from the stored row. Never throws; never rolls back.
  r.report = await writeAuditReport({
    db,
    llm,
    providerError,
    auditId: data.id,
    system: iaCharter,
    maxTokens: MAX_REPORT_TOKENS,
  });
}

if (halted) {
  // Nothing to report: the message and the exit code are already set above.
} else if (AS_JSON) {
  console.log(JSON.stringify(
    results.map((r) => ({
      agent: r.agent.name,
      kind: r.agent.kind,
      severity: r.severity,
      audit_id: r.auditId ?? null,
      report: r.report ? { outcome: r.report.outcome, detail: r.report.detail } : null,
      findings: r.findings,
    })),
    null,
    2,
  ));
} else {
  for (const r of results) {
    const tag = DRY ? "(dry-run, nothing written)" : `audit ${r.auditId ?? "FAILED"}`;
    console.log(`\n── ${r.agent.name} [${r.agent.kind}] — severity ${r.severity} ${tag}`);
    for (const f of r.findings) {
      const mark = f.severity === "ok" ? (f.status === "ran" ? "·" : "?") : "!";
      const note =
        f.status === "ran"
          ? ""
          : `  [${f.status}]`;
      console.log(`  ${mark} #${f.check} ${f.label}: ${f.severity}${note}`);
    }
    if (r.report) {
      console.log(
        r.report.outcome === "written"
          ? `  report: written (${r.report.detail})`
          : `  report: NULL [${r.report.outcome}] — ${r.report.detail}`,
      );
    }
  }
  const byGrade = results.reduce((acc, r) => ({ ...acc, [r.severity]: (acc[r.severity] ?? 0) + 1 }), {});
  const nullReports = results.filter((r) => r.report && r.report.outcome !== "written");
  console.log(
    `\n${results.length} audit(s) ${DRY ? "computed" : "written"} — ` +
      Object.entries(byGrade).map(([k, v]) => `${k}: ${v}`).join(", ") +
      (DRY
        ? ". Dry run: nothing stored, so no report was written — a report is written FROM a stored row."
        : `. Reports: ${results.length - nullReports.length} written, ${nullReports.length} NULL` +
          (llm ? ` (${llm.describe()})` : ` (no provider: ${providerError})`) + "."),
  );
  // A NULL report is a complete audit, so it does not fail the run — but it is
  // never silent. Each one is named with its reason above; this repeats the
  // count where a skimming reader will see it.
  if (nullReports.length) {
    console.log(`  ⚠ ${nullReports.length} audit(s) have findings and severity but NO report — see report_error on each row.`);
  }
}
