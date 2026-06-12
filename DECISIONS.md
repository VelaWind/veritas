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

### Phase A follow-up — proposer provenance on edits (migration 0004)

A refinement requested after the Phase A review: when an **edit** suggestion is
approved, the public timeline event must credit the **original proposer** (human
or agent), not the applying admin. (Creates were already credited to the
proposer; only the hypothesis-update trigger hard-coded `auth.uid()`.)

- **Mechanism.** `apply_suggestion()` publishes the proposer's identity into
  three transaction-local GUCs — `veritas.actor_id`, `veritas.actor_type`,
  `veritas.agent_name` — via `set_config(..., is_local => true)` before it
  writes. `log_hypothesis_update()` reads them, falling back to
  `auth.uid()`/`'human'`/`null` when unset. Transaction-local means they reset
  at commit and never leak across PostgREST requests on a pooled connection.
- **Why a GUC and not a trigger argument.** Triggers can't take parameters, and
  the update is an ordinary `UPDATE` from inside the function — the GUC is the
  standard Postgres way to pass actor context to a trigger within one
  transaction (the same shape Supabase uses for `request.jwt.claims`).
- **No behaviour change for direct admin edits.** With no GUC set, the trigger
  credits `auth.uid()` exactly as before; the new `actor_type`/`agent_name`
  columns on the event default to `'human'`/`null`, matching the prior table
  defaults. Only suggestion-applied edits change.
- **Scope.** Evidence edits emit no timeline event in the existing schema, so
  there is nothing to re-attribute there; only `log_hypothesis_update` and
  `apply_suggestion` are touched (both `create or replace` in 0004, idempotent).
- **Verified by** an added assertion in `verify-suggestions.mjs` (the edit's
  `hypothesis_updated` event must carry `actor_id = proposer`). Requires 0004
  applied alongside 0003.

---

## Phase B — AI agent layer (IMPLEMENTED 2026-06-12)

> **Status: built and verified.** The security + cost model below was signed off,
> then implemented in the staged order of B.8 (migrations 0005/0006 applied to the
> linked project via `supabase db push`). The implementation log and the
> deliberate deviations are in **B.9** at the end of this section. Gates at
> sign-off: `validate:sql`, `tsc`, `build`, and `verify-agents.mjs` (19/19) all
> green.

### B.0 Design intent (the invariant that must not weaken)

AI agents are the **primary researchers**: they read source material, form
conclusions with evidence and confidence, and flag contradictions. But per §10
of the architecture, an agent is **just another contributor** — it **proposes
into the Phase A queue** (`actor_type='agent'`, `agent_name` set) and **never
writes directly to active hypotheses/evidence**. Every agent output flows
through the *same* `/api/suggestions` route, the *same* Zod validation, the
*same* RLS, the *same* `apply_suggestion()` path, the *same* epistemic
constraints and audit triggers as a human contribution — and a human admin
confirms before anything joins the live map. Nothing below relaxes that.

A direct consequence worth stating: **prompt injection in source material cannot
poison the live map.** The worst an injected instruction can do is produce a bad
*proposal*, which lands as `pending` and is rejected by a reviewer (or by the DB
epistemic guard at approval). The agent has no path that bypasses review.

### B.1 Agent identity & scoped tokens

**Each agent is a first-class Supabase identity, deliberately under-privileged.**

- A new `agent` value is added to the `user_role` enum (a fresh migration at
  implementation time; the enum already carries `actor_type='agent'`). An
  `agents` registry table holds one row per agent: `id`, `name` (→ `agent_name`),
  `profile_id` (its Supabase Auth user), `enabled`, `scopes jsonb`
  (`{domains:[…], max_pending, max_per_run, max_per_hour}`), `trust` (see B.3),
  timestamps.
- `is_contributor()` is widened to include `'agent'`, so an agent may **insert
  its own pending suggestions** under the *existing* RLS policy
  (`proposed_by = auth.uid() AND status='pending'`). An agent role gets **no**
  write grant on any knowledge table and **no** `is_admin()` — so it can reach
  *only* the queue, and only its own rows. `apply_suggestion()` keeps its
  `is_admin()` self-guard, so an agent can never approve.
- **Scoped tokens.** Agents are server-to-server; they authenticate with a
  **scoped bearer token**, not a browser session. Recommended:
  a `agent_tokens` table storing `token_hash` (SHA-256; the plaintext is shown
  once at mint and never stored), `agent_id`, `expires_at`, `revoked_at`,
  `last_used_at`. A new `requireAgent()` gate (sibling of `requireContributor`)
  validates `Authorization: Bearer <token>`, resolves the agent, and acts under
  the agent's identity. The token is **capability-narrow** — it is accepted only
  on the propose endpoint; it is never a Supabase service key and carries no
  admin or knowledge-table reach. Tokens are revocable and expiring; minting and
  revocation are admin-only.
- Agents post to a thin `POST /api/agent/suggestions` (or the existing route
  with the agent gate) that stamps `actor_type='agent'`, `agent_name=<agent>`,
  and `proposed_by=<agent profile>`. From there it is byte-identical to a human
  proposal.

**Provenance end-to-end.** Because `suggestions`, the create triggers, and (via
0004) the update trigger all carry `actor_type`/`agent_name`, an approved agent
proposal shows the agent — not the admin — as author on the public timeline.
The reviewing admin is recorded on the suggestion's `reviewed_by`.

### B.2 Rate & volume limits on the queue (defense in depth)

Two independent layers, so a runaway agent can't flood review even if the client
cap is bypassed:

1. **Client-side per-run caps** (in the runner, enforced before each model call
   and each insert): `max_model_calls`, `max_proposals`, `max_tokens` (cumulative
   output budget). The run halts when any is hit. See B.6.
2. **Server-side queue caps** (authoritative, in Postgres): a `BEFORE INSERT`
   trigger on `suggestions` for `actor_type='agent'` enforces the agent's
   `scopes.max_pending` (cap on outstanding `pending` rows) and a rolling
   `max_per_hour` (count of this agent's suggestions in the last hour). Over the
   cap → the insert raises, the route returns 429. This binds even a
   mis-configured or compromised agent token.

Domain scoping: an agent's `scopes.domains` restricts which `domain_id`s it may
propose into (checked in the same trigger), so an agent can be commissioned for
one field without touching others.

### B.3 Handling low-quality or contradictory agent output

- **Review is the quality gate.** Every agent proposal is `pending`; a human
  approves or rejects. The DB epistemic guard (`epistemics_consistent`,
  `enforce_active_rationale`) rejects an internally-inconsistent proposal *at
  approval*, so a bad confidence/status pairing can never be applied even if a
  reviewer slips.
- **Required justification.** An agent proposal must carry a non-empty
  `rationale` and, for a hypothesis, its assumptions + at least one linked or
  proposed piece of evidence (enforced in the agent payload schema). "Confident
  assertion with no evidence" is rejected before it reaches the queue.
- **Duplicate suppression.** The `slug` unique constraint and a pre-insert
  similarity check stop an agent re-proposing what already exists.
- **Trust governor.** Each agent carries a `trust` score derived from its
  approve/reject history. A low approval rate auto-throttles the agent (tighter
  `max_per_run`/`max_per_hour`) and, below a floor, auto-disables it pending
  admin review. This bounds the review burden a misbehaving agent can impose.
- **Contradictory output is a feature, surfaced for review, not auto-acted.**
  The Contradiction Agent (B.5) does **not** write to the `contradictions` table
  (that stays admin + the security-definer scan). It proposes contradiction
  findings into the queue as structured suggestions for an admin to confirm.

### B.4 Auto-approve policy

**Default: NO. Agents can never auto-approve — full stop.** The only apply path
is `apply_suggestion()`, which raises unless `is_admin()`, and no agent is an
admin. There is no code path, flag, or token scope in this design that lets an
agent move its own (or any) suggestion to `approved`. A human reviewer is always
in the loop before anything joins the live map — this is the B.0 invariant, and
it is enforced in Postgres, not in app code.

(If a future phase ever wants "trusted auto-approve" for a specific high-trust
agent, it would be a separate, explicitly-opt-in, admin-gated mechanism with its
own migration and review — out of scope for Phase B, and called out here so it
is never added silently.)

### B.5 The first two agents

- **Research Agent.** Given a question or domain, reads source material via the
  model, drafts a hypothesis (status/confidence/assumptions/falsification) plus
  supporting/contesting evidence with citations, and proposes them into the
  queue. Bounded by the per-run caps. It only ever produces `pending` proposals.
- **Contradiction Agent.** Scans existing hypotheses + evidence for tension the
  mechanical `scan_contradictions()` can't catch (semantic/assumption-level),
  and proposes contradiction findings for admin confirmation. No direct write to
  `contradictions`.

Both are the same shape: read → reason with the model → emit `pending`
proposals. Both inherit every guarantee above.

### B.6 Admin review at volume

Agents can generate proposals faster than humans review them, so the review UI
gains (at implementation): filter by agent / actor_type, batch approve/reject,
a dedup/cluster view, sort by agent `trust` and by evidence strength, and the
agent's rationale + linked evidence inline. The existing `SuggestionQueue`
already renders `agent_name`; these are additive. Trust-based prioritization lets
admins clear high-trust agents quickly and scrutinize low-trust ones.

### B.7 Cost model (designed explicitly — the only thing that costs money)

Model calls are the sole marginal cost. The design makes them **cheap, capped,
and controllable**, and lays a path to near-zero marginal cost via local models.

**Pluggable provider — cloud or local by config only, no code change.** A small
`LlmProvider` interface (`complete(messages, opts) → {text, usage}`) with
adapters selected by environment variables:

| `VERITAS_LLM_PROVIDER` | Adapter | Target |
|---|---|---|
| `anthropic` | official `@anthropic-ai/sdk` | Claude (cloud) |
| `openai` | OpenAI client | OpenAI (cloud) |
| `openai-compatible` | OpenAI-style `/chat/completions` over `VERITAS_LLM_BASE_URL` | **local Ollama** (`http://localhost:11434/v1`), vLLM, LM Studio, … |

Switching cloud↔local is purely `VERITAS_LLM_PROVIDER` + `VERITAS_LLM_BASE_URL`
+ `VERITAS_LLM_MODEL` + `VERITAS_LLM_API_KEY` (server-side only — never
`NEXT_PUBLIC_*`). The runner imports the interface, not a vendor. (Note: the
Anthropic adapter uses the native Anthropic SDK — adaptive thinking + `effort`,
and prompt caching on the stable prefix — rather than an OpenAI-compat shim, so
the cloud path is first-class; the OpenAI-compatible adapter is what makes the
local path config-only.)

**Default mode is ON-DEMAND.** A run is triggered **manually** — a script
(`node scripts/run-research-agent.mjs --question … --max-proposals …`) or an
admin-only button hitting an admin endpoint — does **one bounded unit of work**,
then **stops**. No always-on loop and no cron in V1. (Scheduling is possible
later but ships **off**.)

**Per-run caps so a single run can't run away** (env-configurable, enforced in
the runner; mirrored by the B.2 server caps):

| Cap | Env | Default (cheap) |
|---|---|---|
| Model calls per run | `AGENT_MAX_MODEL_CALLS` | 8 |
| Proposals per run | `AGENT_MAX_PROPOSALS` | 5 |
| Cumulative output tokens | `AGENT_MAX_OUTPUT_TOKENS` | 50_000 |

The runner counts `usage` after every call and aborts the run when a cap trips —
it can leave proposals already made, but never exceeds the bound.

**Hard spending cap at the provider (the real money backstop, set by you).**
The per-run caps bound one run; the *provider* limit bounds total spend across
all runs regardless of bugs:

- **Anthropic:** create a dedicated **Workspace** in the Console for Veritas's
  agent, mint a **Workspace-scoped API key**, and set that workspace's **monthly
  spend limit** (Console → Settings → Limits/Billing) plus its ITPM/OTPM rate
  limits. The agent key cannot spend past the workspace cap. This is independent
  of, and survives, any app-code mistake.
- **OpenAI / OpenAI-compatible cloud:** set a hard monthly **usage limit** in
  Billing → Limits and use a **project-scoped key**.
- **Local (Ollama):** no marginal API cost; the "cap" is just local compute.

Set **both** layers (per-run caps *and* a provider spend limit) — they protect
against different failure modes. **This provider-side step is a console action
only you can take; it is flagged in STATUS.md.**

**Model choice for cost (cheap by default, escalate deliberately).** Defaults
favour the cheapest capable tier; `VERITAS_LLM_MODEL` overrides per run:

| Tier | Model id | Input / Output per MTok | Use |
|---|---|---|---|
| Default (bulk drafting) | `claude-haiku-4-5` | $1 / $5 | Routine research drafts |
| Mid | `claude-sonnet-4-6` | $3 / $15 | Harder synthesis |
| Hard reasoning (occasional) | `claude-opus-4-8` | $5 / $25 | Genuinely hard calls |
| Max | `claude-fable-5` | $10 / $50 | Rare, hardest reasoning |

Two cloud levers cut the bill further on the Anthropic path: **prompt caching**
(the agent's system prompt + Veritas taxonomy/epistemic rules + domain context
are large and stable across a run's calls → cache reads cost ~0.1× input; a run
with several calls pays the cached prefix once) and the **Message Batches API**
(50% off for non-interactive bulk sweeps that tolerate async completion).

**Intended cost trajectory (explicit).**
1. **Now — on-demand cloud, cheap-first.** Manual trigger, Haiku-class default,
   per-run caps, a dedicated Anthropic workspace with a hard spend limit. Cloud
   only.
2. **Later — local model for volume.** Point `VERITAS_LLM_PROVIDER=openai-compatible`
   + `VERITAS_LLM_BASE_URL` at a local Ollama for the **bulk/continuous**
   research (near-zero marginal cost, fully private), and keep **cloud calls only
   for the occasional hard-reasoning sub-task** (escalate specific steps to
   `claude-opus-4-8`/`claude-fable-5`). Config-only; no code change.

### B.8 What ships when (after sign-off)

In order, each its own migration/commit, each kept green and stopping for review
as instructed: (1) `agent` role + `agents`/`agent_tokens` tables + RLS + the B.2
queue-cap trigger + `requireAgent()` gate; (2) the `LlmProvider` interface + the
two adapters; (3) the Research Agent runner + its per-run caps; (4) the
Contradiction Agent runner; (5) review-UI volume features; (6) a
`verify-agents.mjs` end-to-end probe (agent proposes → lands pending → cannot
approve → admin approves → credited to the agent on the timeline → caps enforced).
None of this is written yet.

### B.9 Implementation log (2026-06-12) — built as designed, with these deviations

Built in the B.8 order and applied to the linked project with `supabase db push`.
Each stage kept the gates green and was committed separately. The deviations
below are deliberate; everything else matches the design above.

1. **Local model is the DEFAULT provider (overrides B.7's "cloud cheap-first").**
   Per the sign-off instruction, **zero per-call cost is a hard requirement**, so
   `VERITAS_LLM_PROVIDER` defaults to `openai-compatible` pointed at a LOCAL
   Ollama (`http://localhost:11434/v1`, model `qwen2.5:14b`). The cloud adapters
   (`anthropic`, `openai`) are present and first-class but reachable **only** by
   explicitly setting that env var; a cloud provider selected without
   `VERITAS_LLM_API_KEY` **throws** rather than silently doing anything — nothing
   can bill unless the env is deliberately changed. Ollama needs no key (a dummy
   bearer is sent so the OpenAI-style header is well-formed). The B.7 cost ladder,
   spend caps, prompt caching, and Batch API remain the guidance **if/when** the
   cloud path is switched on.

2. **Adapters are fetch-based REST, not vendor SDKs.** B.7 sketched the Anthropic
   adapter on the native `@anthropic-ai/sdk`. All three are implemented over
   `fetch` against the public REST endpoints instead — no new dependency, nothing
   added to the install footprint or the Next/tsc build for an off-by-default
   path, and a smaller surface that cannot bill. (Anthropic prompt caching is
   still expressible via the REST payload if the cloud path is later enabled.)

3. **The enum add is split across two migrations (0005 + 0006).** Postgres forbids
   *using* a freshly-added enum value in the transaction that *adds* it, so
   `ALTER TYPE user_role ADD VALUE 'agent'` ships alone in 0005; the tables/RLS/
   caps/trust ship in 0006. 0006 also compares `role::text` rather than the enum
   literal, so it is safe even if a single push were to batch both. B.8 named one
   migration; this is the same content, split only for that constraint.

4. **Contradiction findings surface as hypothesis EDIT proposals.** The Phase A
   queue's `target_type` is `hypothesis|evidence` only — 'contradiction' is not a
   suggestable type, and widening it (new `node_type`, new `apply_suggestion`
   branch) is out of Phase B scope. So the Contradiction Agent records a finding
   as a reviewable **edit** on the more contestable hypothesis of the pair: it
   adds an `open_question` naming the tension and puts the full A↔B explanation in
   the rationale. It still **never** writes to `contradictions`; an admin confirms
   and records the formal contradiction. The edit payload carries the target's own
   `domain_id` so a domain-scoped agent passes the server scope check with no real
   domain change.

5. **Trust governor is a trigger, not wired into `apply_suggestion`.** `trust` is
   recomputed by an `AFTER UPDATE OF status` trigger on `suggestions` whenever an
   agent suggestion is approved/rejected (auto-disable below the floor), leaving
   the audited `apply_suggestion()`/reject paths untouched.

6. **Agent inserts run server-side under the service role, gated by the route +
   the quota trigger.** An agent holds a scoped bearer token, not a session, so
   `requireAgent()` resolves it and the route performs a **capability-narrow**
   insert (always `pending`, always the agent's own identity). RLS is bypassed on
   that insert, but the authoritative `enforce_agent_quota` BEFORE INSERT trigger
   and every epistemic constraint at approval still bind. `is_contributor()` is
   still widened to `'agent'` as defense in depth — an agent session, if one were
   ever issued, stays RLS-scoped to its own pending rows.

**Auto-approve remains NO**, enforced in Postgres exactly as B.4 specifies.
**The provider spend cap (B.7) is moot while local** — there is no marginal cost;
it becomes relevant only if `VERITAS_LLM_PROVIDER` is switched to a cloud value,
and is flagged in STATUS.md for that case.

**Shipped:** migrations `0005_agent_role.sql` / `0006_agents.sql`;
`requireAgent()` (`lib/api.ts`) + `POST /api/agent/suggestions`;
`scripts/agent-lib/*` (the `LlmProvider`, per-run caps, epistemics mirror,
parsing/transport helpers); `scripts/run-research-agent.mjs`,
`scripts/run-contradiction-agent.mjs`, `scripts/mint-agent-token.mjs`,
`scripts/verify-agents.mjs`. The review UI already renders `agent_name`, so B.6's
volume features (batch/cluster/trust-sort) are the **only** B.8 item deferred —
additive, not required for the invariant.
