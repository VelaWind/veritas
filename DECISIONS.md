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
- **SQL validation in CI** — `npm run validate:sql` parses the migration and
  seed against the real PostgreSQL grammar (`pg-query-emscripten`). A fresh
  WASM instance is created per statement because the module corrupts its heap
  when one instance parses many large statements.
