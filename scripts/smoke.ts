#!/usr/bin/env node
/**
 * Runtime smoke test — content-level, not status-level.
 *
 *   BASE_URL=http://localhost:3000 npm run smoke
 *   BASE_URL=https://veritas-delta-pearl.vercel.app npm run smoke
 *
 * WHY THIS EXISTS, and why every check reads the body:
 *
 * Production served HTTP 200 on every page for roughly two months while its
 * database was completely unreachable (DECISIONS.md → "the placeholder-URL
 * outage"). Every page rendered its empty state and looked entirely normal.
 * A status-code smoke test would have been green for the whole outage.
 *
 * So: **a 200 is not a pass here.** Every route assertion must find a string
 * that can only be present if a query returned rows, and must NOT find the
 * empty-state copy that the outage produced.
 *
 * Two rules the markers follow, both learned from that outage:
 *
 *   1. A marker must be DATA, never chrome. "Hypotheses" appears in the nav and
 *      "Reality Dashboard" appears in the footer of every page including a
 *      totally empty one, so neither can be a marker. Markers here are seeded
 *      titles: they appear only if the read succeeded.
 *   2. A marker must be absent from the ERROR BOUNDARY too. Since the Phase 2
 *      hardening a failed query throws to a boundary that also returns 200, so
 *      GLOBAL_ABSENT below rejects the boundary copy on every route.
 *
 * Run with plain `node scripts/smoke.ts` — Node 22.18+/24 strips the types
 * natively, so this needs no ts-node, no tsx, and no new dependency.
 */

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 30_000);

// ─── harness ────────────────────────────────────────────────────────────────

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    failures.push(label);
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/**
 * Entity-decode before matching. Seeded titles contain `&` and `'`
 * ("Cosmology & Origins"), which React escapes on the way out, so a raw
 * substring search would miss content that is genuinely on the page.
 */
function decode(html: string): string {
  return html
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x2F;/g, "/");
}

interface Fetched {
  status: number;
  body: string;
  location: string | null;
  contentType: string;
  error?: string;
}

async function get(path: string, redirect: RequestRedirect = "follow"): Promise<Fetched> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, {
      redirect,
      signal: controller.signal,
      headers: { "User-Agent": "veritas-smoke/1.0", Accept: "text/html,application/json" },
    });
    return {
      status: res.status,
      body: await res.text(),
      location: res.headers.get("location"),
      contentType: res.headers.get("content-type") ?? "",
    };
  } catch (err) {
    return {
      status: 0,
      body: "",
      location: null,
      contentType: "",
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

// ─── what must never appear on ANY route ────────────────────────────────────
// The error boundaries render with HTTP 200, so without this a page that failed
// every one of its queries would still look healthy to a status check.

const GLOBAL_ABSENT: string[] = [
  "This part of the map could not be loaded",
  "This data could not be loaded",
  "The observatory went dark",
  "Instrument error",
  "Application error",
  "a server-side exception has occurred",
];

// ─── route specs ────────────────────────────────────────────────────────────
// `contains` — EVERY string must be found (data-derived, never chrome).
// `absent`   — the empty-state copy this page shows when its query returns [].
// `expectData: false` marks a route with no seeded rows yet; it is checked
//   structurally and reported as such rather than being silently skipped.

interface RouteSpec {
  path: string;
  contains: string[];
  /** Regexes that must match — for data that is a NUMBER rather than a string. */
  matches?: { re: RegExp; what: string }[];
  absent?: string[];
  expectData?: boolean;
  note?: string;
}

const ROUTES: RouteSpec[] = [
  {
    path: "/",
    contains: ["Fundamental Physics", "Consciousness & Mind"],
    absent: ["No domains yet", "No statistics yet"],
  },
  {
    path: "/dashboard",
    contains: ["Fundamental Physics"],
    absent: ["No statistics yet", "No recorded events yet"],
  },
  {
    path: "/domains",
    contains: ["Fundamental Physics", "Cosmology & Origins", "Origin of Life"],
    absent: ["No domains yet"],
  },
  {
    path: "/domains/physics",
    contains: ["Fundamental Physics"],
    absent: [
      "No hypotheses recorded in this domain yet",
      "No questions recorded in this domain yet",
    ],
  },
  {
    path: "/hypotheses",
    contains: ["Reality is fundamentally physical"],
    absent: ["No hypotheses match"],
  },
  {
    path: "/hypotheses/reality-is-fundamentally-physical",
    contains: ["Reality is fundamentally physical"],
    absent: ["No evidence linked yet", "No assumptions recorded"],
  },
  {
    path: "/questions",
    contains: ["Why is there something rather than nothing?"],
    absent: ["No questions yet"],
  },
  {
    path: "/questions/something-rather-than-nothing",
    contains: ["Why is there something rather than nothing?"],
    absent: ["No questions yet"],
  },
  {
    path: "/evidence",
    contains: ["Cosmic microwave background power spectrum"],
    absent: ["No evidence yet"],
  },
  {
    path: "/evidence/cmb-power-spectrum",
    contains: ["Cosmic microwave background power spectrum"],
    absent: ["No evidence yet"],
  },
  {
    path: "/notes",
    contains: ["How to read a Veritas confidence score"],
    absent: ["No published notes yet"],
  },
  {
    path: "/notes/reading-the-confidence-meter",
    contains: ["How to read a Veritas confidence score"],
  },
  {
    // /lab lists the five categories, whose NAMES come from the static
    // CATEGORY_META constant — they render even against an empty database, so
    // they are chrome, not data. The only data on this page is the per-category
    // count, so that is what gets asserted: every count would be 0 if
    // listSimulations() returned nothing.
    path: "/lab",
    contains: ["Artificial Ecosystems"],
    matches: [
      { re: /font-mono text-xs text-muted">[1-9]\d*<\/span>/, what: "a non-zero simulation count" },
    ],
    absent: ["No simulations in this category yet"],
  },
  {
    path: "/lab/ecosystems",
    contains: ["Primordial Soup Lab"],
    absent: ["No simulations in this category yet", "No runs recorded yet"],
  },
  {
    path: "/timeline",
    contains: ["Contradiction detected"],
    absent: ["No recorded events yet", "No activity yet"],
  },
  {
    // Canvas-rendered, so the assertion is the aria-label the component emits
    // with its real node/edge counts — which is only non-zero if the payload
    // loaded. The empty case renders "No nodes match the current filters."
    path: "/graph",
    contains: ["Research graph:"],
    absent: ["No nodes match the current filters"],
  },
  {
    path: "/search?q=consciousness",
    contains: ["Consciousness is integrated information"],
  },
  {
    // "Agents" alone would be a bad marker — it appears in the nav of every
    // page, so it would pass on a totally empty site. "Who proposes what" is
    // this page's eyebrow and appears nowhere else, so it proves the route
    // resolved; the display names below prove the QUERY did.
    //
    // The roster was seeded 2026-08-11 (seed-agent-roster.mjs, 8 agents), so
    // this is a real data assertion now rather than a structural one. The three
    // markers are display names straight out of `agent_public` — they cannot
    // render unless listPublicAgents() returned rows. They deliberately span
    // three different `kind` values (research / skeptic / internal_affairs),
    // because the page groups by kind via KIND_ORDER and drops any group with
    // no members: asserting only a researcher would stay green if the oversight
    // agents vanished from the view.
    //
    // NOT used as markers: the group headings ("Research", "Oversight", …) come
    // from the static KIND_META constant and render against an empty database,
    // so they are chrome by this file's rule 1.
    path: "/agents",
    contains: ["Who proposes what", "Physics Researcher", "The Skeptic", "Internal Affairs"],
    absent: ["No agents yet"],
  },
];

// ─── API specs ──────────────────────────────────────────────────────────────

interface ApiSpec {
  path: string;
  validate: (json: unknown) => { ok: boolean; detail: string };
}

/** Every route returns the `{ data, error }` envelope from lib/api.ts. */
function envelope(json: unknown): { data: unknown; error: unknown } | null {
  if (typeof json !== "object" || json === null) return null;
  if (!("data" in json) || !("error" in json)) return null;
  return json as { data: unknown; error: unknown };
}

function arrayOfAtLeast(n: number, fields: string[]) {
  return (json: unknown) => {
    const env = envelope(json);
    if (!env) return { ok: false, detail: "not a { data, error } envelope" };
    if (env.error !== null) return { ok: false, detail: `error=${JSON.stringify(env.error)}` };
    const rows = env.data;
    if (!Array.isArray(rows)) return { ok: false, detail: `data is ${typeof rows}, not an array` };
    if (rows.length < n) return { ok: false, detail: `${rows.length} rows, expected >= ${n}` };
    const first = rows[0] as Record<string, unknown>;
    const missing = fields.filter((f) => !(f in first));
    if (missing.length) return { ok: false, detail: `row missing field(s): ${missing.join(", ")}` };
    return { ok: true, detail: `${rows.length} rows, shape ok` };
  };
}

const APIS: ApiSpec[] = [
  { path: "/api/domains", validate: arrayOfAtLeast(10, ["id", "slug", "name"]) },
  { path: "/api/hypotheses", validate: arrayOfAtLeast(1, ["id", "slug", "title", "status", "confidence"]) },
  { path: "/api/questions", validate: arrayOfAtLeast(1, ["id", "slug", "title"]) },
  { path: "/api/evidence", validate: arrayOfAtLeast(1, ["id", "slug", "title"]) },
  {
    // The contradiction engine: seed.sql runs scan_contradictions(), so a live
    // seeded database MUST return rows. Zero here means the scan never ran, or
    // the read is being silently filtered — the exact shape of the 0002 GRANT
    // bug, which also presented as a valid, empty, 200 response.
    path: "/api/contradictions",
    validate: arrayOfAtLeast(1, ["id", "hypothesis_a", "hypothesis_b", "kind"]),
  },
  {
    path: "/api/stats",
    validate: (json) => {
      const env = envelope(json);
      if (!env) return { ok: false, detail: "not a { data, error } envelope" };
      if (env.error !== null) return { ok: false, detail: `error=${JSON.stringify(env.error)}` };
      const s = env.data as Record<string, unknown> | null;
      if (!s) return { ok: false, detail: "data is null — dashboard_stats never refreshed" };
      const n = s.total_hypotheses;
      if (typeof n !== "number") return { ok: false, detail: "total_hypotheses is not a number" };
      if (n <= 0) return { ok: false, detail: `total_hypotheses = ${n}, expected > 0` };
      return { ok: true, detail: `total_hypotheses=${n}, total_evidence=${s.total_evidence}` };
    },
  },
  {
    path: "/api/timeline",
    validate: (json) => {
      const env = envelope(json);
      if (!env) return { ok: false, detail: "not a { data, error } envelope" };
      if (env.error !== null) return { ok: false, detail: `error=${JSON.stringify(env.error)}` };
      const d = env.data as { events?: unknown[] } | null;
      if (!d || !Array.isArray(d.events)) return { ok: false, detail: "data.events is not an array" };
      if (d.events.length < 1) return { ok: false, detail: "0 events" };
      return { ok: true, detail: `${d.events.length} events` };
    },
  },
  {
    path: "/api/graph",
    validate: (json) => {
      const env = envelope(json);
      if (!env) return { ok: false, detail: "not a { data, error } envelope" };
      if (env.error !== null) return { ok: false, detail: `error=${JSON.stringify(env.error)}` };
      const g = env.data as { nodes?: unknown[]; edges?: unknown[] } | null;
      if (!g || !Array.isArray(g.nodes) || !Array.isArray(g.edges)) {
        return { ok: false, detail: "data.nodes / data.edges missing" };
      }
      if (g.nodes.length < 1) return { ok: false, detail: "0 nodes" };
      return { ok: true, detail: `${g.nodes.length} nodes, ${g.edges.length} edges` };
    },
  },
  { path: "/api/search?q=consciousness", validate: arrayOfAtLeast(1, ["id", "title"]) },
];

// ─── run ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`\nVeritas smoke test`);
  console.log(`  target : ${BASE}`);
  console.log(`  started: ${new Date().toISOString()}`);
  console.log(`  note   : a 200 is not a pass — every check reads the body\n`);

  console.log("── Public routes ──────────────────────────────────────────────");
  for (const spec of ROUTES) {
    const res = await get(spec.path);
    const label = spec.path;

    if (res.error) {
      check(`${label} — reachable`, false, `fetch failed: ${res.error}`);
      continue;
    }
    if (res.status !== 200) {
      check(`${label} — 200`, false, `got ${res.status}`);
      continue;
    }

    const body = decode(res.body);

    const boundary = GLOBAL_ABSENT.filter((m) => body.includes(m));
    check(
      `${label} — no error boundary`,
      boundary.length === 0,
      boundary.length ? `rendered: "${boundary[0]}" (with HTTP 200)` : "",
    );

    const missing = spec.contains.filter((m) => !body.includes(m));
    check(
      `${label} — content${spec.expectData === false ? " (structural)" : ""}`,
      missing.length === 0,
      missing.length ? `missing marker(s): ${missing.map((m) => `"${m}"`).join(", ")}` : "",
    );

    if (spec.matches?.length) {
      // Matched against the RAW body: these target markup, not prose, and
      // entity-decoding would alter the attribute text they anchor on.
      const unmatched = spec.matches.filter((m) => !m.re.test(res.body));
      check(
        `${label} — data present`,
        unmatched.length === 0,
        unmatched.length ? `no match for ${unmatched.map((m) => m.what).join(", ")}` : "",
      );
    }

    if (spec.absent?.length) {
      const found = spec.absent.filter((m) => body.includes(m));
      check(
        `${label} — no empty state`,
        found.length === 0,
        found.length ? `rendered empty state: "${found[0]}"` : "",
      );
    }
    if (spec.note) console.log(`      ↳ ${spec.note}`);
  }

  console.log("\n── Auth gate ──────────────────────────────────────────────────");
  for (const path of ["/admin", "/admin/suggestions", "/contribute"]) {
    const res = await get(path, "manual");
    if (res.error) {
      check(`${path} — redirects to /login`, false, `fetch failed: ${res.error}`);
      continue;
    }
    const isRedirect = res.status === 307 || res.status === 302 || res.status === 303;
    const toLogin = (res.location ?? "").includes("/login");
    check(
      `${path} — unauthenticated redirect to /login`,
      isRedirect && toLogin,
      `status ${res.status}, location ${res.location ?? "(none)"}`,
    );
  }

  console.log("\n── API routes ─────────────────────────────────────────────────");
  for (const spec of APIS) {
    const res = await get(spec.path);
    if (res.error) {
      check(`${spec.path} — reachable`, false, `fetch failed: ${res.error}`);
      continue;
    }
    if (res.status !== 200) {
      check(`${spec.path} — 200`, false, `got ${res.status}`);
      continue;
    }
    if (!res.contentType.includes("application/json")) {
      check(`${spec.path} — JSON`, false, `content-type: ${res.contentType || "(none)"}`);
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(res.body);
    } catch (err) {
      check(`${spec.path} — valid JSON`, false, err instanceof Error ? err.message : String(err));
      continue;
    }
    const { ok, detail } = spec.validate(json);
    check(`${spec.path} — shape + rows`, ok, detail);
    if (ok && detail) console.log(`      ↳ ${detail}`);
  }

  // ── Page ↔ API agreement (AUDIT.md F-09) ──────────────────────────────────
  // The page and the API read the SAME query function, but only the API route
  // wraps it in unstable_cache. So they can disagree — and when they do, the
  // cached side is serving a stale empty payload with HTTP 200.
  //
  // This is the check that actually exposed F-09: /api/graph reported 0 nodes
  // while /graph, on the same server in the same second, rendered
  // "Research graph: 76 nodes, 99 edges". Neither side alone looks wrong.
  // Disagreement is the signal, so disagreement is a FAILURE.
  console.log("\n── Page ↔ API agreement (F-09 cache poisoning) ────────────────");

  {
    const [page, api] = await Promise.all([get("/graph"), get("/api/graph")]);
    const rendered = page.body.match(/Research graph: (\d+) nodes, (\d+) edges/);
    let apiNodes: number | null = null;
    let apiEdges: number | null = null;
    try {
      const g = (JSON.parse(api.body) as { data?: { nodes?: unknown[]; edges?: unknown[] } }).data;
      apiNodes = Array.isArray(g?.nodes) ? g.nodes.length : null;
      apiEdges = Array.isArray(g?.edges) ? g.edges.length : null;
    } catch {
      /* reported below as unparseable */
    }

    if (!rendered || apiNodes === null || apiEdges === null) {
      check(
        "/graph page and /api/graph agree",
        false,
        `could not compare — page aria-label ${rendered ? "found" : "MISSING"}, api nodes ${apiNodes ?? "unparseable"}`,
      );
    } else {
      const pageNodes = Number(rendered[1]);
      const pageEdges = Number(rendered[2]);
      check(
        "/graph page and /api/graph agree on node count",
        pageNodes === apiNodes,
        `page renders ${pageNodes} nodes, API returns ${apiNodes} — a disagreement means one side is serving a cached empty payload`,
      );
      check(
        "/graph page and /api/graph agree on edge count",
        pageEdges === apiEdges,
        `page renders ${pageEdges} edges, API returns ${apiEdges}`,
      );
      check(
        "/api/graph is not an empty payload",
        apiNodes > 0,
        `API returned ${apiNodes} nodes against a seeded database`,
      );
    }
  }

  {
    const [page, api] = await Promise.all([get("/dashboard"), get("/api/stats")]);
    // The Stat component renders the number, then its label.
    const rendered = page.body.match(/tabular-nums"[^>]*>(\d+)<\/p>[\s\S]{0,200}?Hypotheses</);
    let apiTotal: number | null = null;
    try {
      const s = (JSON.parse(api.body) as { data?: { total_hypotheses?: number } }).data;
      apiTotal = typeof s?.total_hypotheses === "number" ? s.total_hypotheses : null;
    } catch {
      /* reported below */
    }

    if (!rendered || apiTotal === null) {
      check(
        "/dashboard page and /api/stats agree",
        false,
        `could not compare — page stat ${rendered ? rendered[1] : "MISSING"}, api total_hypotheses ${apiTotal ?? "null (stats payload is null)"}`,
      );
    } else {
      const pageTotal = Number(rendered[1]);
      check(
        "/dashboard page and /api/stats agree on hypothesis count",
        pageTotal === apiTotal,
        `page renders ${pageTotal}, API returns ${apiTotal} — a disagreement means one side is serving a cached empty payload`,
      );
      check(
        "/api/stats is not an empty payload",
        apiTotal > 0,
        `API returned total_hypotheses=${apiTotal} against a seeded database`,
      );
    }
  }

  // ─── anon GRANTS on the keep-public relations (AUDIT.md F-07) ─────────────
  //
  // 0009 revoked the blanket default that handed `anon` rights on every future
  // table. That is the right shape, but it makes a grant regression cheap: one
  // stray REVOKE, or a new migration that rebuilds a relation and forgets to
  // re-grant, and anon silently loses read on something the public site needs.
  //
  // 0002_fix_rls.sql is the precedent — RLS enabled with no matching GRANT,
  // every row denied to anon, pages rendering their empty state under HTTP 200.
  // The route checks above would catch that for the handful of relations whose
  // content appears in a marker, but NOT for the embedded ones (sources,
  // hypothesis_evidence, confidence_history, simulation_runs), which surface
  // only as a missing sub-section on a page that still looks fine.
  //
  // So this asks PostgREST the same question a browser's anon client asks. A
  // privilege failure is HTTP 401/403 with SQLSTATE 42501; an RLS denial is a
  // 200 with `[]`. We assert on the PRIVILEGE, so 0 rows is a pass here —
  // content is already covered by the route and API assertions above.
  console.log("\n── anon can still read the keep-public relations (F-07) ───────");

  const KEEP_PUBLIC = [
    "domains", "hypotheses", "questions", "evidence", "sources",
    "hypothesis_evidence", "confidence_history", "contradictions",
    "timeline_events", "research_notes", "simulations", "simulation_runs",
    "graph_edges", "citation_checks", "dashboard_stats", "agent_public",
    "agent_public_stats",
    // Added by 0010. Public because the deliberation is the transparency
    // artifact of Phase D — and since 0010 was the first migration to create a
    // public table after 0009 revoked anon's default grant, these two are
    // exactly where a forgotten explicit GRANT would surface first.
    "councils", "council_turns",
  ];

  let sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  let sbKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!sbUrl || !sbKey) {
    const { readFileSync, existsSync } = await import("node:fs");
    if (existsSync(".env.local")) {
      for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
        if (!line || line.startsWith("#") || !line.includes("=")) continue;
        const i = line.indexOf("=");
        const k = line.slice(0, i).trim();
        const v = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
        if (k === "NEXT_PUBLIC_SUPABASE_URL" && !sbUrl) sbUrl = v;
        if (k === "NEXT_PUBLIC_SUPABASE_ANON_KEY" && !sbKey) sbKey = v;
      }
    }
  }

  // Missing credentials is a FAILURE, not a skip. A guard that quietly does
  // nothing when it cannot run is the exact failure mode this file exists to
  // prevent — it would report ALL GREEN having checked nothing.
  if (!sbUrl || !sbKey) {
    check(
      "F-07: anon credentials available for the grant check",
      false,
      "set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, or run from a directory with .env.local — the grant check cannot be skipped silently",
    );
  } else {
    const base = sbUrl.replace(/\/$/, "");
    for (const rel of KEEP_PUBLIC) {
      let status = 0;
      let body = "";
      try {
        const res = await fetch(
          `${base}/rest/v1/${rel}?select=*&limit=1`,
          {
            headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` },
            signal: AbortSignal.timeout(TIMEOUT_MS),
          },
        );
        status = res.status;
        body = (await res.text()).slice(0, 200);
      } catch (err) {
        body = err instanceof Error ? err.message : String(err);
      }
      check(
        `anon can read ${rel}`,
        status === 200,
        `HTTP ${status || "network error"} ${body}${
          body.includes("42501") ? "  <- GRANT REVOKED (SQLSTATE 42501)" : ""
        }`,
      );
    }
  }

  // ─── /council/[id] — the transcript renders (§D.3) ────────────────────────
  //
  // The id is a runtime uuid, so unlike every other page spec this one has to
  // DISCOVER its target: it asks the public API for the newest complete council
  // and then renders that. Which means the assertion is real data twice over —
  // the row has to exist, and the page has to show what the row says.
  //
  // A missing council is a FAILURE, not a skip, by the same rule as the F-07
  // credentials above: a check that quietly does nothing when it cannot run
  // reports ALL GREEN having checked nothing. If this fires on a fresh
  // database, run `node scripts/run-council.mjs --hypothesis <slug>`.
  console.log("\n── /council/[id] — a real transcript renders ─────────────────");

  if (!sbUrl || !sbKey) {
    check("council: anon credentials available", false, "same credentials as the F-07 block above");
  } else {
    let council: {
      id: string;
      subject_title: string;
      outcome: string | null;
      rounds_run: number;
    } | null = null;
    let detail = "";
    try {
      const res = await fetch(
        `${sbUrl.replace(/\/$/, "")}/rest/v1/councils` +
          `?select=id,subject_title,outcome,rounds_run&status=eq.complete` +
          `&order=started_at.desc&limit=1`,
        {
          headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
      );
      const rows = (await res.json()) as unknown;
      if (Array.isArray(rows) && rows.length > 0) council = rows[0];
      else detail = `HTTP ${res.status}, ${Array.isArray(rows) ? "0 rows" : "unexpected body"}`;
    } catch (err) {
      detail = err instanceof Error ? err.message : String(err);
    }

    check(
      "council: a complete council exists to render",
      council !== null,
      council ? "" : `${detail} — run scripts/run-council.mjs to create one`,
    );

    if (council) {
      const path = `/council/${council.id}`;
      const res = await get(path);
      if (res.error || res.status !== 200) {
        check(`${path} — 200`, false, res.error ?? `got ${res.status}`);
      } else {
        const body = decode(res.body);
        const boundary = GLOBAL_ABSENT.filter((m) => body.includes(m));
        check(
          `${path} — no error boundary`,
          boundary.length === 0,
          boundary.length ? `rendered: "${boundary[0]}" (with HTTP 200)` : "",
        );

        // "Council transcript" is this page's eyebrow and appears nowhere else,
        // so it proves the route resolved. The subject title and "Round 1" come
        // out of `councils` and `council_turns` respectively — neither can
        // render unless BOTH queries returned rows, which is the pair of anon
        // grants 0010 had to add explicitly.
        const markers = ["Council transcript", council.subject_title, "Round 1"];
        const missing = markers.filter((m) => !body.includes(m));
        check(
          `${path} — content`,
          missing.length === 0,
          missing.length ? `missing marker(s): ${missing.map((m) => `"${m}"`).join(", ")}` : "",
        );

        check(
          `${path} — no empty state`,
          !body.includes("No turns recorded"),
          body.includes("No turns recorded") ? "rendered the empty transcript state" : "",
        );
        console.log(
          `      ↳ ${council.id} — outcome ${council.outcome}, ${council.rounds_run} rounds`,
        );
      }
    }
  }

  console.log(
    `\n${fail === 0 ? "ALL GREEN" : `${fail} FAILURE(S)`} — ${pass} passed, ${fail} failed  (${BASE})`,
  );
  if (fail > 0) {
    console.log("\nFailed:");
    for (const f of failures) console.log(`  · ${f}`);
  }
  process.exitCode = fail === 0 ? 0 : 1;
}

export {}; // makes this a module, so the top-level await below is legal

await main();
