# DECISIONS

Running log of implementation decisions made while building Veritas V1.0
against `veritas-architecture-v1.md`. Spec deviations are marked **[deviation]**;
everything else is a choice the spec left open.

## Phase 0 — Foundation

- **Next.js 15 (App Router)** — spec says "Next.js 14+"; 15 is current stable
  with React 19 and the async `params`/`cookies()` APIs. All code uses the
  Next 15 conventions.
- **Tailwind CSS 3.4** — the spec's folder structure includes
  `tailwind.config.ts`, which is the v3 configuration model (v4 moved to
  CSS-first config). Staying on v3 keeps the file layout exactly as specced.
- **No Docker on the build machine** — `supabase start` could not be run
  locally (CLI v2.104 present, Docker absent). The migration and seed were
  validated by close review against PostgreSQL 15 semantics instead;
  README documents how to apply them with the CLI against a real project.
- **Env fallbacks for buildability** — Supabase client factories fall back to
  placeholder credentials when env vars are absent, and all public-page
  queries catch connection errors and return empty results, so
  `npm run build` (which prerenders ISR pages) succeeds with no live
  database. With real credentials the same pages render seed data.
- **Markdown rendering** via `react-markdown` + `remark-gfm` with a
  hand-rolled `.markdown` stylesheet (no typography plugin) so prose colors
  stay on design tokens.
- **Fonts** via `next/font/google` (Spectral 300/500, Inter 400/500/600,
  IBM Plex Mono 400/500), self-hosted at build time by Next.

## Migration (0001_core.sql) — spec fixes, all marked in-file

- **[deviation] Fixed SQL syntax error in §2.6** — the spec's
  `create trigger trg_confidence on hypotheses before update on hypotheses…`
  names the table twice, which does not parse. Implemented as
  `create trigger trg_confidence before update on hypotheses…`.
- **Added `unique (hypothesis_a, hypothesis_b, kind)` to `contradictions`** —
  §2.7's `scan_contradictions()` relies on `on conflict do nothing`, which
  silently never conflicts without a unique constraint, producing duplicate
  rows on every scan. The constraint makes the scan idempotent as intended.
- **Added the `enforce_active_rationale` trigger** — §2.3 comments that a
  non-empty `confidence_rationale` is "REQUIRED … before state='active'
  (trigger below)" but the trigger is never shown. Implemented it.
- **Added lifecycle timeline triggers** — §2.1 defines event types
  (`hypothesis_created`, `hypothesis_updated`, `hypothesis_status_changed`,
  `evidence_added`, `evidence_unlinked`, `question_added`, `note_published`,
  `contradiction_detected`, `contradiction_resolved`, `simulation_completed`)
  that no specced trigger emits, while principle §1.2-2 requires every change
  to emit timeline events from the write path. Added security-definer
  triggers for each so history is genuinely a byproduct of writes.
- **Added `graph_nodes` view** — §1.2-3 references a uniform node identity
  view by name; defined it as a union over the five node types.
- **Added `refresh_dashboard_stats()` + `increment_popularity()` RPCs** —
  the matview needs a security-definer refresh hook callable from the API,
  and `hypotheses.popularity` ("view counter") needs an anon-callable
  incrementer; neither had DDL in the spec.
- **`dashboard_stats` is created `with no data` and refreshed in seed** —
  the matview is defined before any rows exist; the seed (and the admin
  "refresh stats" action) populate it.

## Phase 1 — Knowledge core

- **Cookieless `publicClient` for public reads** — public RSC pages use a
  cookie-less anon client (`lib/supabase/public.ts`) rather than the
  cookie-bound server client, because calling `cookies()` forces a route to be
  dynamic and would defeat the §1.3 SSG/ISR strategy. It sees exactly what an
  anonymous visitor sees under RLS.
- **Query layer swallows connection errors** — every `lib/queries/*` function
  try/catches and returns empty results, so `next build` (which prerenders ISR
  pages) succeeds against placeholder credentials. With a real database the
  same functions return data.
- **Untyped runtime clients + cast in the query layer** — the Supabase clients
  are not generic-typed against `Database`; the query layer casts PostgREST
  results to the hand-written app types in `types/domain.ts`. This keeps
  `database.types.ts` a non-load-bearing reference (so a `supabase gen types`
  refresh can never break the build) while pages still get full typing.
- **Extra API routes beyond the §6 table** — added thin CRUD routes for
  `domains` and `notes` (and `PATCH` for simulations) because the admin area
  needs them; the §6 table omitted them but §3 lists the admin CRUD surfaces.
- **`POST /api/stats`** refreshes the matview (admin-only) — §2.10 says "route
  handler calls rpc" but the §6 table only lists `GET /api/stats`.
- **`increment_popularity` via a client `ViewTracker`** — the hypothesis view
  counter fires from the browser, not the ISR-cached server page, so the cached
  render stays side-effect-free.

## Phase 2–4 — Public surfaces, instruments, graph & lab

- **Markdown without the typography plugin** — a hand-rolled `.markdown`
  stylesheet keeps prose on the design tokens (signal colors stay reserved).
- **FTS snippet sanitization** — `ts_headline` wraps matches in `<b>` but does
  not escape the surrounding admin-authored source text, which is an XSS
  vector. `sanitizeHeadline()` escapes the whole string then re-enables only
  the `<b>` markers, so any embedded HTML renders inert while the highlight
  still shows. Used everywhere a snippet is rendered.
- **Research Graph drawn to `<canvas>`** (not SVG) per §7 for node-count
  headroom; an SVG/HTML overlay would not scale to thousands of nodes. Labels
  are drawn on-canvas for focused/hovered nodes and all domains. Under
  `prefers-reduced-motion` the simulation settles synchronously with no
  animated tick.
- **Friendly lab category slugs** — the URL uses `ecosystems|agents|
  civilizations|universes|consciousness` (per §3) mapped to the DB category
  enum in `lib/knowledge-engine/simulations.ts`.
- **Metrics chart auto-detects series keys** — `simulation_runs.metrics` is
  free-form jsonb; `parseMetrics` reads `{series:[{t, …}]}` and plots every
  numeric key it finds, so different simulations can record different metrics.

## Phase 5 — Hardening & launch

- **OG images via `next/og` with literal hex colors** — `next/og` has no CSS
  variables, so the signal palette is inlined in `opengraph-image.tsx`. The
  per-hypothesis image renders status + confidence + rationale; Next's file
  convention injects it automatically (so `generateMetadata` does not also set
  `openGraph.images`).
- **Rate limiting is best-effort in-memory** — `/api/search` uses a per-instance
  token bucket. On serverless each instance has its own bucket; this is a soft
  control. A KV/edge-backed limiter is the V1.x hardening if abuse appears.
- **SQL validation in CI** — `npm run validate:sql` parses the migrations and
  seed against the real PostgreSQL grammar (`pg-query-emscripten`). A fresh
  WASM instance is created per statement because the module corrupts its heap
  when one instance parses many large statements.

## Post-launch fix — empty public reads (migration 0002_fix_rls.sql)

- **Root cause (diagnosed live, not guessed):** public reads returned `[]`.
  A live diagnostic (`scripts/diagnose-rls.mjs`) showed every base table
  returning SQL state **42501 "permission denied for table"** for BOTH the
  `anon` and `service_role` roles — a missing table-level GRANT, which is
  evaluated *before* RLS. It was NOT an RLS row-filter or `is_admin()` problem
  (`is_admin()` correctly returns `false`, and `state <> 'draft' OR is_admin()`
  is `TRUE` for active rows regardless). The home-page *stats* worked only
  because 0001 granted the `dashboard_stats` matview explicitly while never
  granting the base tables — it relied on Supabase default privileges that did
  not apply in this project.
- **Why it looked silent:** the query layer's `if (error) return []` (kept so
  `next build` succeeds with no DB) swallowed the 42501 error, so a privilege
  failure presented as an empty-but-no-error result. This is a deliberate
  build-time-resilience tradeoff; runtime error surfacing to platform logs is a
  reasonable follow-up (done in the launch-readiness pass below —
  `lib/queries/log.ts`).
- **Fix:** explicit GRANTs to `anon` (SELECT), `authenticated` (SELECT/INSERT/
  UPDATE/DELETE — RLS gates writes), and `service_role` (ALL), plus sequence/
  function grants and matching `ALTER DEFAULT PRIVILEGES` so future objects are
  covered. Mirrored into 0001; shipped as idempotent 0002 for the live DB.
- **Also in 0002:** `is_admin()` made explicitly null-safe; public-read
  policies on `hypotheses`/`research_notes` split so the public condition
  stands alone (no `is_admin()` in the read path); and
  `scan_contradictions()` casts `'system'::actor_type` — the bare literal
  resolves to `text` under `SELECT DISTINCT` and there is no implicit
  `text -> actor_type` cast, so the insert would fail 42804 the moment the scan
  found a contradiction to record.

## Launch-readiness pass (2026-06-11)

One finishing sweep before launch; everything verified against the live
database, not by inspection alone.

- **Public read paths audited live** — `scripts/audit-pages.mjs` replays every
  public route's *exact* PostgREST select (embeds included) plus the
  `global_search` / `suggested_confidence` RPCs through the anon client and
  fails on any error or zero-row result. All 21 paths green against the seeded
  live DB.
- **Query-layer errors now logged, still safe** — `lib/queries/log.ts`
  (`logQueryError` / `logQueryThrow`): every `if (error) return …` and `catch`
  in `lib/queries/*` logs `[veritas:query:<fn>] [code] message` to the server
  console (Vercel function logs) before returning the safe fallback. Builds
  without a database still pass; a future 42501-class failure can no longer be
  silent. Closes the follow-up from the 0002 postmortem.
- **A11y pass** — `lib/useFocusTrap.ts` gives `Dialog` and `CommandPalette`
  real WAI-ARIA modal behavior (Tab containment + focus restore; the palette's
  trap ref was initially unwired — it no-opped silently). `Tabs` got the full
  tabs keyboard pattern (roving tabindex, Arrow/Home/End,
  `aria-controls`/`aria-labelledby`). The mobile menu closes on Escape.
  `scripts/contrast.mjs` checks the signal palette against both surfaces in
  both themes — all AA (≥4.5 text, ≥3 signal/UI). Deliberately *not* changed:
  stat grids at 375px (snug but no overflow), graph legend (`flex-wrap`),
  ledger titles (normal text wraps). **Known limitation:** the canvas Research
  Graph is pointer-only; keyboard node navigation is V1.x work.
- **Admin write path verified end-to-end** — `scripts/verify-admin.mjs` drives
  the real HTTP routes (middleware → `requireAdmin` → RLS → triggers) with a
  forged `@supabase/ssr` session cookie for a temporary service-role-provisioned
  admin. 19/19 checks: create (draft, anon-invisible under RLS), edit,
  link/unlink evidence (graph-edge trigger both directions), confidence change
  rejected without/with-blank rationale and out-of-band value, accepted with
  rationale and recorded in `confidence_history`, unauthenticated write → 401,
  contradiction scan → 200 (inserted 0 — seed already converged).
- **Probe hygiene on a live DB** — the probe hypothesis runs in `state='draft'`
  (never publicly visible); the scan runs only *after* the probe is deleted so
  it cannot pair probe data with seeded hypotheses; the service role then
  removes the probe row and its timeline events. The append-only invariant
  (§10-3) binds app roles — service-role cleanup of test artifacts is an ops
  action, used for nothing else.
- **Gates at sign-off:** `npm run build` (113 pages, SSG params resolved from
  live data), `tsc --noEmit`, and `npm run validate:sql` all pass clean.
