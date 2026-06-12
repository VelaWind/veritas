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

---

# Post-1.0

The phases below extend the architecture's "Post-1.0 horizon" (§9). Each ships
behind the same invariant: **the database enforces epistemics and authorization;
application code is thin.** No phase weakens an existing constraint, RLS policy,
or auth gate, and no phase gives any non-admin direct write access to the
knowledge tables.

## Phase A — Researcher role + suggestion queue (migration 0003)

**Goal.** Let `researcher`-role users propose new hypotheses/evidence and edits
without touching public knowledge; admins approve or reject. The `researcher`
role already existed in the `user_role` enum (reserved in 1.0 for exactly this),
so no enum change was needed.

**The one new write path is a queue, not the knowledge tables.** Contributors
write only into `suggestions` (RLS-scoped to their own `pending` rows). They can
never insert/update/delete `hypotheses`/`evidence` directly — the existing
"admin all / admin write" policies are unchanged, and no contributor policy was
added to any knowledge table.

**Authorization model (three gates, mirroring §4.2).**
- *Propose*: `requireContributor()` (handler) admits `researcher|admin`; RLS
  `"contributor insert own"` forces `proposed_by = auth.uid()` and
  `status='pending'`; `is_contributor()` is a null-safe security-definer helper
  modelled exactly on `is_admin()`.
- *Approve*: `requireAdmin()` (handler) → the `apply_suggestion()` function
  self-guards with `is_admin()` and raises `42501` otherwise. A contributor
  cannot self-approve: the `"proposer update own pending"` RLS `with check`
  permits only `pending → pending|withdrawn`, and a direct PostgREST attempt to
  set `status='approved'` matches no permissive policy (verified by the live
  script's RLS probe).

**Approval is one atomic, fully-audited transaction.** `apply_suggestion(id,
notes)` (security definer) re-reads the locked suggestion, inserts/updates the
real node, and stamps the review fields in a single transaction. The insert/
update fires the **existing** triggers (`log_hypothesis_insert`,
`log_hypothesis_update`, `log_confidence_change`, `touch_updated_at`,
`on_evidence_linked` where relevant) and is checked by the **existing**
constraints (`epistemics_consistent`, `enforce_active_rationale`). Security
definer bypasses *RLS* on the target tables (so the function self-guards on
`is_admin()`), but CHECK constraints and triggers are **not** RLS and still
fire — so every epistemic guarantee holds. An epistemically invalid proposal
(e.g. status `established` with confidence 30) is rejected by the DB at approval
time with a clear message, and the suggestion stays pending.

**Why a DB function and not the route doing the insert.** Atomicity: apply +
status-update must not be separable (no orphaned "approved but not applied", no
double-apply on retry). The function also keeps the epistemic write path in
Postgres, consistent with the §6 design note. Cost: the function maps
`payload` jsonb → columns, which mirrors the admin `POST` routes. The shared
contract that keeps them in sync is the Zod schema: the propose route validates
each payload with the *same* `hypothesisCreateSchema`/`evidenceCreateSchema`/…
the admin forms use (`SUGGESTION_PAYLOAD_SCHEMAS`), so an approved suggestion
yields exactly what a direct admin write would.

**Attribution.** Created nodes carry the **proposer** as
`created_by`/`actor_type`/`agent_name`, so the lifecycle trigger credits the
proposer in the public timeline ("hypothesis proposed by X"). `reviewed_by`
records the approving admin on the suggestion row. One asymmetry, by design and
documented: the `hypothesis_updated` timeline event for an *edit* is written by
the existing trigger with `actor_id = auth.uid()` = the applying admin (that
trigger is untouched working code). Full provenance is always reconstructable by
joining the suggestion (`applied_id → node`).

**Scope decisions (deliberate, to avoid weakening anything).**
- *Confidence is not editable through the queue.* It is the most
  epistemically-sensitive field and admins own it via the dedicated confidence
  editor (which records `confidence_history`). The edit path mirrors the admin
  edit form, which also excludes confidence. A `create` proposal *does* carry an
  initial confidence (it is a new record an admin must approve; the band
  constraint still applies).
- *Target types are limited to `hypothesis` and `evidence`* via a CHECK on
  `suggestions.target_type` (which reuses `node_type`). Domains/questions/
  simulations/notes remain admin-only in Phase A.

**Reuse, not duplication.** `actor_type`/`agent_name` columns on `suggestions`
exist now so Phase B agents propose into the *same* table and the *same*
`apply_suggestion()` path — no second review mechanism. The admin `HypothesisForm`
/`EvidenceForm` gained a `propose` prop that re-targets submission to
`/api/suggestions` (one source of truth for each form; the admin path is byte-
for-byte unchanged when `propose` is absent).

**Verification.** `scripts/verify-suggestions.mjs` drives the real HTTP routes
with forged cookies for a temp admin + two researchers + one public user:
propose→approve (create + edit), reject (reason required), withdraw, evidence
create with inline source, and the negative cases — anonymous→401, public-role→
403, researcher-approve→403, the direct-PostgREST self-approve RLS probe, cross-
researcher read isolation, and the credited-to-proposer audit event. It is gated
on migration 0003 being applied to the live DB (it reports BLOCKED if not). SQL
is parser-validated (`npm run validate:sql`), and `npm run build` / `tsc` pass.
