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

---

# Recurring class — soft failures (a fallback that outlived its state)

## Post-launch fix — the placeholder-URL outage (2026-08-09)

**The incident.** `veritas-delta-pearl.vercel.app` served every page with HTTP 200
for roughly two months while its database was completely unreachable. Vercel's
logs carried `[veritas:query:listTimeline] TypeError: fetch failed` once per
query per request; every page rendered its empty state and looked entirely
normal.

**Root cause.** *(Attribution corrected 2026-08-10 — see "Correction" at the end
of this entry. The Sensitive flag does not withhold values from builds; the
recorded mechanism is disproven and the actual cause is undetermined.)* `NEXT_PUBLIC_SUPABASE_URL` was marked
**"Sensitive"** in Vercel's
environment-variable settings. A `NEXT_PUBLIC_*` value must be inlined into the
bundle at build time, which is exactly what the Sensitive flag prevents — so the
variable read as present and correct in the dashboard while being empty during
the build. `lib/supabase/env.ts` fell through to `https://placeholder.supabase.co`,
that host does not resolve, and every fetch failed at the network layer. The
value is inlined into the *server* bundle too, so it could not be corrected at
runtime; only a rebuild would fix it.

**This is the third instance of one failure shape, not a one-off.** All three are
*a wrong value produced a plausible-looking success*:

1. **0002 missing GRANT** — SQL state 42501 on every base table, swallowed by
   `if (error) return []`. Presented as an empty knowledge base.
2. **Placeholder baked into `NEXT_PUBLIC_SUPABASE_URL` at the original deploy** —
   auth called a non-existent host. Presented as login simply not working.
3. **This outage** — the same placeholder, this time via the Sensitive flag, for
   two months. Presented as an empty knowledge base.

**The pattern worth recording.** This codebase's safety fallbacks — placeholder
credentials in `env.ts`, empty-array returns in `lib/queries/*` — exist so the
build works without a database. Every one of them converts a hard failure into a
soft, invisible one. They are individually correct and collectively a hazard,
because each one is reachable from states it was never designed for.

**The rule going forward: a fallback must be reachable only in the state it was
designed for.** Concretely: fallbacks are gated on `HAS_LIVE_SUPABASE`. With no
credentials, fallbacks apply and the build works. With live credentials, there is
no fallback — failures are loud. Any future fallback added to this codebase must
name the state it is for and be unreachable outside it.

### Fix 1 — production refuses to build on placeholder credentials

`lib/supabase/env.ts` throws at module load when the target is production and
`HAS_LIVE_SUPABASE` is false. The message names the Sensitive-flag trap
explicitly, because the dashboard shows nothing wrong and the next person to hit
this will have forgotten.

- **`VERCEL_ENV`, not `NODE_ENV`, is the production signal on Vercel.**
  `next build` sets `NODE_ENV=production` for preview and production deploys
  alike, so `NODE_ENV` cannot tell them apart.
- **Off Vercel, `NODE_ENV=production` counts only outside the build phase.**
  `next build` always sets `NODE_ENV=production`, *including* the credential-free
  local build these placeholders exist to support. `NEXT_PHASE !==
  'phase-production-build'` exempts that build while still catching a self-hosted
  `next start` running on placeholders.
- **The throw is server-guarded (`typeof window === "undefined"`).** `env.ts` is
  imported by `lib/supabase/client.ts`, which is browser code; an unguarded
  module-load check could fire in a visitor's browser instead of in the build. It
  cannot trigger on a correctly configured deploy — the guard makes that
  impossible rather than merely unlikely.

**Local development and preview builds still work with no credentials at all.**
That property is why the placeholder exists and it is deliberately retained. What
is now impossible is *shipping a production build that uses it*.

### Fix 2 — a failed query no longer looks like an empty one

The distinction is made once, in `lib/queries/log.ts`, which all 58 error paths
in `lib/queries/*` already funnel through — so there is one place to reason about
and no call site drifts:

- `HAS_LIVE_SUPABASE === false` → unchanged. Log, return the fallback, render the
  empty state. This is the no-credentials path and it stays exactly as it was.
- `HAS_LIVE_SUPABASE === true` and the query failed → log as before, then throw
  `QueryFailedError`.

`logQueryThrow` re-throws an existing `QueryFailedError` unchanged rather than
logging it a second time, since several query functions wrap their own bodies in
`try/catch` and would otherwise double-report. `incrementPopularity` is untouched
— a lost view tick is genuinely not an error.

**The empty states themselves are unchanged.** "No hypotheses match your filters"
is still correct and still needed; it simply can no longer be what a reader sees
when the database is unreachable.

### Error boundaries — a throw is a designed state

The Phase 5 boundaries (`app/global-error.tsx`, `app/(public)/error.tsx`,
`app/admin/error.tsx`) already existed and were already on the token system; their
copy was extended to distinguish a fault from an absence. **Added: a root
`app/error.tsx`** — the public boundary is scoped to the `(public)` route group,
so `/contribute` and `/(auth)` previously fell through to `global-error.tsx`,
which discards the layout and reads as a crash.

Every boundary now states plainly that the data could not be loaded and that this
is a fault rather than an absence, in the visual language of the empty states it
must never be confused with.

### Accepted trade-off — Vercel builds now depend on Supabase being reachable

SSG pages fetch at build time. Now that queries throw on failure, **a transient
Supabase outage during a build turns a shipped-but-empty deploy into a failed
deploy.** That is the correct trade and the entire point of the change — a failed
build is visible in thirty seconds, an empty deploy went unnoticed for two months
— but it is a real new coupling and is recorded as such: `npm run build` has a
live dependency on Supabase. A build failing at "Generating static pages" with
`QueryFailedError` means the database was unreachable, not that the code is wrong.

### Verified

- `npm run build`, no environment variables at all → **succeeds** (the
  no-credentials path is intact).
- `VERCEL_ENV=production npm run build`, no credentials → **fails** at "Collecting
  page data" with the Sensitive-flag message.
- `VERCEL_ENV=production npm run build`, real credentials → **succeeds**, 115
  static pages from live data.
- Live credentials pointed at an unreachable host, production server: `/timeline`
  logs `[veritas:query:listTimeline] TypeError: fetch failed` — the exact line
  from the outage — then throws, and the page renders the **error boundary**
  inside the normal layout. The empty state does not appear. (Reproduced by
  building through a local proxy and then killing it, because `NEXT_PUBLIC_*` is
  inlined at build time and cannot be broken at runtime — itself a confirmation
  of the root-cause mechanism.)
- `tsc --noEmit`, `npm run validate:sql` (7 files), `node scripts/contrast.mjs`
  (ALL PASS) all clean.

### Correction (2026-08-10) — the Sensitive flag does not blank the build

The root-cause attribution above was tested empirically against the live
deployment during setup for the planned Vercel experiment (AUDIT.md §8 — whether
a credential-free *preview* deployment can poison *production's* Data Cache;
still UNVERIFIED and unaffected by this correction), because it contained a
contradiction: `NEXT_PUBLIC_SITE_URL` is *also* marked Sensitive (60 days old,
never recreated), yet production's sitemap carries the correct domain.

**Evidence, all gathered without changing any Vercel setting:**

1. `vercel env pull --environment=production` returns
   `NEXT_PUBLIC_SITE_URL=""` and `SUPABASE_SERVICE_ROLE_KEY=""` (Sensitive —
   undecryptable after creation) but plaintext values for
   `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (recreated
   non-Sensitive 2026-08-08/09). So SITE_URL **is** Sensitive in Production and
   Preview, today.
2. Production `/sitemap.xml` and `/robots.txt` emit
   `https://veritas-delta-pearl.vercel.app`, not the `localhost:3000` fallback.
3. Next 15.1 inlines `NEXT_PUBLIC_*` into the **server** bundle as a build-time
   literal: the local build output contains the URL string verbatim in
   `.next/server/app/sitemap.xml/route.js` and `robots.txt/route.js`, and no
   `process.env.NEXT_PUBLIC_SITE_URL` read survives anywhere under
   `.next/server`. ISR regeneration therefore re-runs the same baked literal —
   it cannot repair a value that was empty at build. Point 2 thus proves the
   Sensitive value **was present in the build environment** of the current
   production deployment (built 2026-08-10).
4. Client chunks (all 19 referenced by `/`, `/login`, `/timeline`, `/search`,
   `/lab`): the non-Sensitive `NEXT_PUBLIC_SUPABASE_URL` value appears inlined
   in the login chunk (positive control — inlining works and is observable).
   The SITE_URL value appears in none of them — but neither does its
   `localhost:3000` fallback string, so the constant was tree-shaken out (no
   client code references it). Its absence says nothing about the flag.

**The client/server inlining question is settled without further experiment.**
There is one build environment and Next's inlining is flag-blind text substitution
applied to both compilations; there is no mechanism by which Sensitive could
block client inlining while permitting server inlining — and server inlining of
a Sensitive value demonstrably worked (point 3).

**What this does to the root cause above — wrong then, or Vercel changed
since:** three things favor *wrong then*. (a) Vercel's sensitive-env docs, last
updated 2026-06-03 — before this project's first deploy — describe only
read-back protection and *build-log redaction*; redacting a value from build
logs presupposes it is present during the build. (b) The diagnosis's own line
"read as present and correct in the dashboard" cannot be literally true of a
Sensitive variable — its value is unreadable after creation, so its correctness
was never actually verified. (c) The 2026-08-05 redeploys, built with the old
variable still in place, did not fix the site — for the flag theory to survive,
Vercel would have to have changed behavior in the five days before 2026-08-10.
**The recorded root cause is disproven; the actual cause of the outage is
undetermined.** A wrong or empty value stored at creation would fit the
evidence, but the old value was unreadable (the flag's one real effect) and the
variable is deleted, so no candidate cause can be confirmed or ranked against
the alternatives. What can be said is only that the 2026-08-08 recreation —
which both re-entered the value and dropped the flag — coincided with the fix,
without establishing which aspect mattered. A platform change between June and
early August cannot be fully excluded; a change after 2026-08-05 is what the
flag theory requires, and nothing supports one.

**What stands unchanged:** every fix in this entry. Fix 1, Fix 2, and the
fallback rule defend against *an empty value reaching a production build*,
whichever way it arrives — wrong stored value, deleted variable, or flag
semantics on some future platform. The guard message's mention of the Sensitive
flag should be read as "the value can be missing while the dashboard shows a
variable exists", not "the flag blanks builds". Likewise the "Verified"
parenthetical above confirmed the *inlined-at-build* mechanism, not the flag's
role in it.

## Fourth instance — the cached fallback (2026-08-10, AUDIT.md F-09)

**The same class again, and this one got past the fix for the last one.**

`unstable_cache` keys record nothing about credentials. A run where
`HAS_LIVE_SUPABASE` is false returns the query layer's empty fallback — the
designed, correct behaviour for that state — and `unstable_cache` stores it
under *exactly the key a credentialed run uses*. The entry survives a rebuild,
and a later credentialed server serves it as a fresh hit for the full revalidate
window: 900s for `/api/stats`, 3600s for `/api/graph`. HTTP 200, valid
`{ data, error: null }` envelope, empty payload.

**Why the Phase 2 loud-failure design did not catch it.** That design makes a
*failed* query loud: with live credentials `logQueryError`/`logQueryThrow` throw
instead of returning the fallback. But nothing failed here. The empty value was
produced by a healthy code path in the state it was designed for
(no credentials → return fallback), and was then *carried across a state
boundary* by the cache into a context where that state no longer held. Phase 2
gated the fallback on `HAS_LIVE_SUPABASE` at the moment of computation; it had
no way to know a value computed under one setting of that flag would be replayed
under the other.

So the rule from the third instance — *a fallback must be reachable only in the
state it was designed for* — needs a second clause:

> **A fallback must not outlive the state it was computed in.** Anything that
> persists a value across process boundaries — a cache, a snapshot, a
> materialized view — must either record the state the value was computed under,
> or refuse to store values computed in a degraded state.

**Mitigations chosen: M1 and M2 (AUDIT.md §8.3). M3 and M4 held in reserve.**

- **M1 — bypass the cache entirely when `HAS_LIVE_SUPABASE` is false.**
  `app/api/graph/route.ts:19` and `app/api/stats/route.ts:31`. This is the fix
  for the cause: the degraded value is never offered to the cache at all.
  Verified — a credential-free preview runtime that previously wrote **2**
  poisoned entries now writes **0**, while still serving the empty payload
  correctly.
- **M2 — refuse to *store* an empty payload when credentials are live.** Inside
  each cached callback, an empty result throws `EmptyPayloadError`
  (`lib/api.ts`), because throwing is the only way to tell `unstable_cache` not
  to persist a value. The route catches it and answers from an **uncached** read.
  That distinction is the whole design: the empty result is still *served*, it is
  only refused entry to the cache — so a fresh pre-seed database renders its
  empty state rather than erroring, which is what M2 in the audit warned about.
  Any other error, including `QueryFailedError`, propagates and stays loud.

**Known residual risk, stated because it is easy to misread.** M1 and M2 are
**write-path** mitigations. They stop poison being created; they do not detect or
clean poison that already exists. A cache poisoned before these shipped will keep
serving until the entry revalidates or the cache is cleared — verified by
hand-writing the poisoned entries back after the mitigation and observing them
served unchanged. That is precisely why the smoke assertion stays:
`scripts/smoke.ts` fails when `/graph` and `/api/graph` disagree on node count,
or when either payload is empty against a seeded database.

**Verified whether Vercel production is exposed: UNVERIFIED.** A Vercel
*production* build cannot be created without credentials (the `env.ts` guard
throws on `VERCEL_ENV=production`), so production cannot poison its own cache.
A Vercel *preview* runs with the guard deliberately silent and can. Whether
preview and production share a Data Cache is not answerable from this repository;
AUDIT.md §8.2 records the three questions that would settle it.

---

# Phase D — The agent society (DESIGN ONLY — awaiting sign-off)

> **Nothing in this section is built.** It is the Stage 0 design for review. No
> migration is written, no script exists, no schema is changed. Implementation
> starts only after sign-off, in the order at D.10.

## D.0 The invariants this phase does not touch

Phase D adds agents, opinions, and public surfaces. It adds **no new write path
to the knowledge tables**, and every guarantee from §B.0 holds unchanged:

- Agents **propose into `suggestions`** and nothing else. No agent, council, or
  auditor gains `is_admin()`, and `apply_suggestion()` keeps its `is_admin()`
  self-guard, so no agent can approve anything — its own or anyone's.
- The provider stays **local Ollama by default, $0/call**. Every new lane
  (skeptic, council, IA) uses the same `complete()` interface and the same cloud
  adapters that are off unless `VERITAS_LLM_PROVIDER` is deliberately set.
- Every run is **on-demand and bounded** by the existing per-run cap machinery.
  The new lanes do not get their own budget; they spend the *same* one (D.8).
- Prompt injection still cannot poison the map. More agents means more
  *proposals*, all of them `pending`.

Three things get genuinely new powers, and each is bounded in Postgres rather
than in the runner:

| New power | Bound |
|---|---|
| Skeptic annotates a proposal | Cannot change its status. No trigger from critiques to `suggestions`; verified by script. |
| Council proposes a verdict | Lands as an ordinary `pending` suggestion. Same queue, same caps, same review. |
| IA throttles/suspends an agent | A security-definer function that permits **only** monotonically more-restrictive transitions. Cannot reinstate, cannot touch knowledge. |

## D.1 Domain-expert agents, displayed

**Registry extension.** `agents` gains: `display_name`, `kind` (new enum
`agent_kind`: `research | contradiction | skeptic | verifier | council |
internal_affairs`), `charter text` (the persona/research approach that becomes
the system prompt), `domain_id uuid references domains(id)` (field of expertise,
nullable for roster-wide agents), and `status` (new enum `agent_status`:
`active | throttled | suspended`).

**`status` vs the existing `enabled`.** `enabled` is what the verified Phase B
`enforce_agent_quota` trigger reads, and I am not rewriting that check. Instead
`status` becomes authoritative and a `BEFORE INSERT OR UPDATE` trigger derives
`enabled := (status <> 'suspended')`. This forces two consequences worth naming
now, because both mean replacing a function that Phase B verified 19/19:

- `recompute_agent_trust()` currently does `set enabled = false` on the
  trust-floor breach. That write would be overwritten by the derive trigger, so
  it is replaced (`create or replace`) to set `status = 'suspended'` instead.
  Same behaviour, expressed through the new authoritative column.
- `enforce_agent_quota()` is replaced to read `status` and, when `throttled`,
  divide `max_pending`/`max_per_hour` by `scopes.throttle_divisor` (default 4,
  floor 1). Everything else in the trigger is byte-identical.

Both are `create or replace`, both are behaviour-preserving for every case
`verify-agents.mjs` already covers, and that script must stay 19/19 before the
stage is committed — with new cases added for throttle and derive.

**Public profile surface, without exposing the registry.** `agents` is admin-only
under RLS with `revoke all from anon`, and RLS cannot restrict *columns*. So the
public surface is a **view**, `agent_public`, selecting only:

```
name, display_name, kind, charter, domain (joined slug + name), status,
trust, created_at, last_audit_at, last_audit_severity, last_audit_summary
```

The view is deliberately **`security_invoker = off`** (the default), so it runs
as owner and bypasses the admin-only RLS on `agents`. That is the exact inverse
of the choice made for `graph_nodes` in 0001, which is `security_invoker = on`
so the reader's RLS applies. The inversion is intentional and the reason is the
column list: here the projection *is* the security boundary, and it is a fixed,
reviewable set of columns rather than a row filter. `scopes` (caps, domain ids)
and everything in `agent_tokens` stay unreachable.

**Stats without exposing the queue.** `suggestions` is never public and stays
that way. A second view `agent_public_stats` exposes **counts only** — proposed,
approved, rejected, pending, and the derived approval rate — never payloads,
never rationales, never pending content.

**"Recent activity" is the public timeline, not the queue.** An agent's activity
feed on its profile reads `timeline_events where agent_name = …`, which is
already anon-readable and is the honest public record: what the agent actually
got *approved* into the map. Pending work stays invisible until a human accepts
it. This needs no new exposure at all.

**Seed roster** (nine identities, one model underneath, expertise entirely in
`charter` + `domain_id` + token scope):

| Agent | kind | Domain |
|---|---|---|
| `physics-researcher` | research | physics |
| `cosmology-researcher` | research | cosmology |
| `consciousness-researcher` | research | consciousness |
| `mathematics-researcher` | research | mathematics |
| `origin-of-life-researcher` | research | origin-of-life |
| `contradiction-agent` | contradiction | — (roster-wide) |
| `skeptic` | skeptic | — |
| `citation-verifier` | verifier | — |
| `internal-affairs` | internal_affairs | — |
| `council` | council | — |

That is ten rows; the council proposes under its own identity so verdicts are
attributable (D.3). Provisioning nine-plus Supabase identities by hand is not
reasonable, so `scripts/seed-agent-roster.mjs` creates the auth users, profiles
at role `agent`, registry rows, and charters idempotently under the service role.
Domain slugs are resolved at seed time and the script fails loudly if a domain is
missing rather than seeding a scopeless agent.

**Pages.** `/agents` (index, grouped by kind) and `/agents/[name]` (charter,
domain, status, trust, approval rate, last audit result, recent activity). Public,
on the existing token system, static with ISR like the rest of the observatory.

## D.2 Skeptic pass on every proposal (always-on lane)

**Storage.** New table `suggestion_critiques`:

```
id, suggestion_id → suggestions(id) on delete cascade,
critic_agent_id → agents(id), verdict (enum critique_verdict:
  weak_assumption | evidence_thin | confidence_overstated |
  scope_creep | sound), body text, findings jsonb, created_at
```

`sound` exists so "I attacked this and it held" is recordable — otherwise the
skeptic is incentivised to manufacture objections, which is the same conformity
failure in the opposite direction.

**How it attaches, and why it is one transaction.** D.2 requires the critique to
exist *before* the proposal enters the queue, but the critique needs the
suggestion's id as a foreign key. Resolving that by inserting the suggestion,
then the critique, leaves a window where an uncritiqued proposal is visible in
review. So the propose route accepts an optional `critique` object and both rows
are written by one security-definer function, `propose_with_critique()`, in a
single transaction. A research-lane proposal without a critique is rejected at
the route. The skeptic's critique is produced **in-process during the same run**,
before the HTTP call — the runner drafts, critiques, then posts once.

**The skeptic cannot block, mechanically.** There is no trigger from
`suggestion_critiques` to `suggestions`; the critique table has no path to
`status`. The skeptic agent holds an ordinary agent token, so it cannot approve
(`apply_suggestion` self-guards) and cannot reject (admin route). A `sound`
verdict does not fast-track anything either — there is no auto-approve in this
codebase and D.2 does not add one. Verified by an explicit assertion: insert a
maximally hostile critique, assert the suggestion is still `pending`.

**Prompt design against conformity.** The skeptic's system prompt is adversarial
by construction — find the weakest assumption, attack the evidence, check the
confidence is honest against the band — and it never sees the proposing agent's
identity or trust score, so it cannot learn to go easy on a high-trust
colleague. It is rewarded for specific, checkable objections; "looks reasonable"
is not an acceptable output and the parser rejects it.

**Visibility.** Admin-only, alongside the proposal it critiques. The review queue
renders proposal and strongest objection side by side. Critiques are not public
because the proposals they attach to are not public; the *council* transcript is
the public deliberation artifact (D.3).

## D.3 Full council on demand

**Schema.** Two tables, both **public**:

```
councils      id, subject_type ('hypothesis'|'question'), subject_id, subject_slug,
              status (running|complete|aborted), rounds_run,
              outcome (enum council_outcome: consensus | split | no_verdict),
              vote jsonb            -- final position per role
              verdict text,          -- the synthesizer's write-up
              suggestion_id → suggestions(id),   -- the proposal it produced
              model, started_at, completed_at

council_turns council_id, round int, seq int,
              role (enum council_role: advocate|skeptic|verifier|synthesizer),
              agent_id, content text, reasoning text, created_at
```

`council_turns` stores `reasoning` separately from `content` because D.3 requires
**sharing reasoning chains between rounds**, not just conclusions — the next
round's prompt is built from prior `reasoning`, and the public transcript renders
both.

**Disagreement is recorded, never resolved by force.** `outcome` has no
"majority wins" path: a 2–2 split is stored as `split` with each role's final
position in `vote`, and the synthesizer is instructed to *write the disagreement*
— what each side would need to see to change its mind — rather than to pick a
winner. `no_verdict` covers a council that ran out of rounds or budget. The
verdict proposal's rationale carries the split verbatim.

**The verdict lands as an ordinary suggestion.** An `edit` proposal on the
subject hypothesis, credited to the `council` agent identity, with a rationale
citing `/council/<id>`. It is `pending` like everything else. Note the Phase B
constraint that shaped this: `suggestions.target_type` is `hypothesis|evidence`
only, so a council convened on a *question* proposes the edit against the
question's most contested hypothesis and says so in the rationale — the same
shape as B.9 deviation 4 for contradiction findings, for the same reason.

**Rendering.** `/council/[id]` — subject, outcome badge, the vote, then the
transcript by round with each role's turn. Linked from the hypothesis/question
page ("this claim has been debated"). Public, no auth.

**Practical bound, stated because it will bite.** Four roles × N rounds is
4N model calls plus synthesis. On a local 14B model at consumer speed a 3-round
council is roughly 13 calls and can take 10–20 minutes. Default `--rounds 2`, and
the transcript passed between rounds is budgeted: per-turn output is capped
(~400 tokens) and prior turns are included newest-first until a context budget is
reached, with an explicit `[earlier turns truncated]` marker in the prompt and in
the stored transcript. Without that budget, round 3 silently overflows a 32k
context and the model starts ignoring the earliest arguments — which would look
like reasoning and would not be.

## D.4 Internal Affairs

**Mechanical first, model second.** Every check below is computed in SQL/JS and
stored as structured `findings` *before* any model call. The model writes the
report *from* those findings and cannot invent one. If the model is unavailable
the audit still produces its findings and a null report.

| # | Check | Source |
|---|---|---|
| 1 | Citations that fail to resolve | `citation_checks` (D.5a) `status in ('unresolved','mismatch')` joined to the agent's recent proposals |
| 2 | Proposals outside the agent's domain | `suggestions.payload->>'domain_id'` vs the agent's `domain_id`. Note the quota trigger already blocks out-of-*scope* inserts, so this catches the case it cannot: an agent proposing outside its **declared expertise** while still inside its token scope, and scope drift after an admin edits `scopes` |
| 3 | Cap violations (429s) and their frequency | New `agent_incidents` table, written by the propose route when the quota trigger raises `53400`/`42501`. **This ships in the first migration, not with IA**, so there is history to audit by the time IA runs |
| 4 | Near-duplicate resubmission | Normalized-title/slug match between a new `pending` proposal and this agent's own previously `rejected` ones. Exact normalized match only — no `pg_trgm` dependency, so genuine near-duplicates with reworded titles will be missed; stated as a known limit rather than implied coverage |
| 5 | Approval-rate trend vs roster baseline | `suggestions` counts over a trailing window per agent, compared to the roster median |
| 6 | Stale pending / abandoned follow-ups | `pending` older than N days; `open_question`s an agent added and never returned to |

**Storage.** `agent_audits`: `id, agent_id (null = roster-wide), run_at,
findings jsonb, report text, severity (enum audit_severity: ok | notice |
concern | critical), public_summary text, actions_taken jsonb`.

**Powers, enforced in Postgres.** IA acts only through
`ia_apply_sanction(p_agent_name, p_action, p_reason)`, security definer,
executable by `service_role` only, called from a capability-narrow route after
`requireAgent()` confirms the caller's registry row has `kind =
'internal_affairs'`. The function:

- accepts `p_action` in `('throttle','suspend')` and nothing else;
- ranks status `active=0 < throttled=1 < suspended=2` and **raises unless the new
  rank is strictly greater than the current one**. Loosening is not a permission
  it lacks — it is a transition the function refuses to express;
- writes `agents.status` and an `agent_audits` action row, and touches nothing
  else. No knowledge table, no `scopes`, no `trust`, no delete, no insert of
  agents.

Reinstatement (`→ active`) is admin-only, via `requireAdmin()` and a separate
route, never reachable from any agent token.

**Suspension is fail-safe.** It sets `enabled=false` through the derive trigger,
which makes the quota trigger reject that agent's inserts. It stops work; it
cannot corrupt the map, because nothing IA can reach is a knowledge table.

**The auditor is not exempt.** `internal-affairs` is an ordinary registry row
with a public profile, its runs are `agent_audits` rows like any other, and it is
included in its own roster sweep. It *may* sanction itself — self-suspension is
fail-safe and therefore allowed — and it cannot un-suspend itself, because
reinstatement is admin-only. That asymmetry is the point.

## D.5 Site features

**(a) Citation verifier — keyed by citation, not by proposal.** Crossref +
OpenAlex over `fetch`, both free and keyless (Crossref's polite pool wants a
contact address: optional `VERITAS_CROSSREF_MAILTO`, no key). Table
`citation_checks` is keyed on the **normalized citation** (lowercased DOI, else
normalized URL), not on a suggestion or evidence id:

```
citation_key text primary key, doi, status (enum citation_status:
verified | unresolved | mismatch), resolved_title, resolved_year,
matched_via (doi|title), score numeric, source (crossref|openalex),
raw jsonb, checked_at
```

Keying on the citation rather than the row means **no change to
`apply_suggestion()`** is needed to carry a result from proposal to approved
evidence — the queue and the public evidence page both look the check up by the
citation they already hold. It is also reusable: two agents citing the same DOI
resolve it once. Public-readable, because it is a fact about a public citation.
`unresolved` is a badge, never an auto-reject, exactly as specified.

**(b) State of the Debate, per question.** Public, at
`/questions/[slug]/debate`, linked from the question page. Competing hypotheses
with confidence, the evidence balance (supporting vs opposing weight, which
`suggested_confidence()` already computes), open contradictions, any council
transcripts on those hypotheses, and how the picture moved over time from
`confidence_history`. **No schema change** — every input already exists and is
already public.

**(c) Confidence over time — extend, do not duplicate.** `ConfidenceMeter`
already contains a `HistorySparkline`: an unlabelled inline-SVG sparkline hidden
inside the details disclosure. The plan is to promote it to
`components/charts/ConfidenceOverTime.tsx` — a real dated axis on Recharts (an
existing dependency), with the rationale for each change on hover — and have
`ConfidenceMeter` render that instead of its private sparkline. One component,
not two. `confidence_history` already carries a public SELECT policy. The
dashboard's map-wide "how beliefs moved" view aggregates the same table.

**(d) Public changelog.** `/changelog`, grouped by week from `timeline_events`,
joined with `councils` so verdicts appear alongside. Deliberately **no new
`timeline_event_type` value**: adding one would force the migration split
described in B.9 deviation 3, and the councils table already carries everything
needed to render the entry.

## D.6 Schema summary — four migrations, applied with `supabase db push`

The CLI is linked, so these apply directly; no dashboard paste (unlike 0003/0004).
One migration per implementation stage, so each commit is independently
verifiable.

| Migration | Adds |
|---|---|
| `0007_agent_roster.sql` | enums `agent_kind`, `agent_status`; `agents` columns (`display_name`, `kind`, `charter`, `domain_id`, `status`); derive trigger for `enabled`; **replaces** `recompute_agent_trust()` and `enforce_agent_quota()`; `agent_incidents`; views `agent_public`, `agent_public_stats`; grants |
| `0008_critiques_citations.sql` | enums `critique_verdict`, `citation_status`; `suggestion_critiques`; `citation_checks`; `propose_with_critique()`; RLS + grants |
| `0009_council.sql` | enums `council_role`, `council_outcome`; `councils`, `council_turns`; public SELECT policies; grants |
| `0010_internal_affairs.sql` | enum `audit_severity`; `agent_audits`; `ia_apply_sanction()`; RLS + grants |

**No `ALTER TYPE … ADD VALUE` anywhere in Phase D.** Every enum above is a *new*
type, which Postgres permits creating and using in the same transaction — the
B.9 deviation 3 split applies only to adding values to an existing enum, and
avoiding that is one reason the changelog derives council entries from `councils`
rather than from a new `timeline_event_type`.

## D.7 Public vs admin-only — the complete matrix

| Surface | Anon | Admin | Notes |
|---|---|---|---|
| `agent_public`, `agent_public_stats` views | read | read | Fixed column projection; the security boundary |
| `agents`, `agent_tokens` base tables | **no** | read/write | Unchanged from Phase B |
| `councils`, `council_turns` | read | read | Full transcripts public — the transparency artifact |
| `citation_checks` | read | read | Facts about public citations |
| `confidence_history`, `timeline_events` | read | read | Already public in 0001 |
| `suggestions` | **no** | read/write | Unchanged — never public |
| `suggestion_critiques` | **no** | read | Attached to non-public proposals |
| `agent_audits` full report | **no** | read | `/admin/audits` |
| `agent_audits` → `public_summary`, `severity`, `run_at` | read | read | Surfaced via `agent_public` only |
| `agent_incidents` | **no** | read | Operational detail |
| Pages `/agents`, `/agents/[name]`, `/council/[id]`, `/changelog`, `/questions/[slug]/debate` | public | — | |
| Page `/admin/audits` | — | admin | |

The rule behind the matrix: **deliberation is public, the queue is not.** What an
agent argued and what it got approved are public record; what it has *proposed
and not yet had accepted* is not, because pending content is unreviewed and
publishing it would make the map look like it contains claims it does not.

## D.8 Cost, caps, and the local-model reality

Still **$0/call** — local Ollama by default, Crossref and OpenAlex free and
keyless, no new dependency anywhere in this phase.

The real budget is *time and calls*, and the new lanes multiply both:

- **The skeptic roughly doubles a research run's model calls.** Its calls count
  against the *same* `max_model_calls` — it does not get its own budget. So an
  existing `--max-model-calls 8` run now yields about half as many proposals
  unless raised. That is the correct trade (every proposal arrives with its
  strongest objection attached) but it is a behaviour change to an existing
  script and must be called out in STATUS.
- **A council is the expensive object**: ~4N+1 calls, minutes not seconds
  locally. Default `--rounds 2`; hard-capped by the existing cap machinery.
- **IA is nearly free**: six mechanical checks in SQL, one model call for the
  write-up.

## D.9 Verification plan — the new invariants

`verify-agents.mjs` stays 19/19 and gains a Phase D block; `verify-suggestions.mjs`
and `verify-admin.mjs` must stay green untouched. New assertions, each one the
mechanical form of a promise made above:

1. **Skeptic cannot block** — insert a hostile critique on a pending proposal;
   assert status is still `pending` and no timeline event fired.
2. **A research-lane proposal without a critique is refused** at the route.
3. **IA cannot reinstate** — `ia_apply_sanction('…','reinstate',…)` raises;
   suspended → active via the function raises; the admin route succeeds.
4. **IA cannot touch knowledge** — attempt a hypothesis write with the IA token;
   expect 401/403.
5. **Council verdict lands as `pending` only** — assert the produced suggestion
   is `pending`, credited to `council`, and that no hypothesis row changed.
6. **Throttle actually throttles** — set `throttled`, assert the quota trigger
   rejects at the divided cap with `53400`.
7. **Suspension is fail-safe** — suspended agent's insert raises `42501`.
8. **Public views leak nothing** — query `agent_public` as anon and assert the
   column set; assert `agents`, `agent_tokens`, `suggestions`,
   `suggestion_critiques` all return zero rows / error for anon.
9. **Self-audit is not special** — IA may suspend itself; IA cannot un-suspend
   itself.

Plus the standing gates at every commit: `validate:sql`, `tsc --noEmit`,
`npm run build`, `contrast.mjs`.

## D.10 Implementation order, and what I want confirmed first

Order, one commit and one migration per stage, gates green at each:
**1.** 0007 + roster seed + `/agents` profiles → **2.** 0008 + skeptic lane +
citation verifier → **3.** 0009 + council → **4.** 0010 + IA → **5.** site
features (b), (c), (d).

Open questions I would rather settle before writing code than discover mid-build:

1. **Is `trust` genuinely public?** D.1 says show it. It is a number that can
   read as harsh (a 40% approval rate is a public scarlet letter for an agent
   that is doing legitimately hard work in a contested domain). Alternative:
   public profile shows approval rate and last audit result, and `trust` stays
   admin-only. I will do exactly what you say; flagging it because it is
   irreversible once the page is indexed.
2. **Replacing two Phase-B-verified functions** (`recompute_agent_trust`,
   `enforce_agent_quota`) is the highest-risk change in the phase. The
   alternative is to leave `enabled` authoritative and treat `status` as
   cosmetic — simpler and lower risk, but then throttling has no teeth and IA's
   main power is decorative. I recommend the replacement, with the existing 19
   checks re-run as the gate.
3. **Council on a question proposes against its most contested hypothesis** (the
   B.9 deviation 4 shape). The cleaner alternative is to widen
   `suggestions.target_type` to include `question`, which means a new
   `apply_suggestion()` branch and touching the most safety-critical function in
   the schema. I recommend the deviation-4 shape for Phase D and a separate,
   deliberate migration later if question edits become common.
4. **Ten agent identities** need auth users, profiles, and tokens. The seed
   script needs `SUPABASE_SERVICE_ROLE_KEY` and is destructive-adjacent (it
   creates auth users). Confirm you want it to provision all ten, or a smaller
   starter roster.

---

# Dependency security — AUDIT.md F-01 (2026-08-10)

**Option A from `SECURITY-REVIEW.md`, applied on `master`.** The review is
cherry-picked onto `master` (commit `846b3cb`) so the reasoning below has a
source in the tree; the `chore/next-16-upgrade` branch it was written on is
deleted, because its premise was disproven by its own contents — the Next 15→16
major is *not* required for the `next` CVEs.

**What moved.** `next` 15.5.19 → **15.5.23** (patch), `postcss` 8.5.15 →
**8.5.26**, `nanoid` 3.3.12 → **3.3.18**. `npm audit` went from 4 high-severity
groups (15 distinct advisories) to **3 groups**, and the `next` entry no longer
carries any advisory of its own — it is now listed only as *"Depends on
vulnerable versions of postcss / sharp"*. All eight `next` CVEs
(CVE-2026-64641/64643/64644/64645/64646/64647/64648/64649, each patched in
15.5.21) are cleared by a patch bump inside the 15.x line.

## The two that remain are knowingly accepted, not fixed

A future `npm audit` **will still report these**. That is the expected state, not
a regression and not an oversight:

| Remaining | Version | Why it cannot move on 15.x | Why it is accepted |
|---|---|---|---|
| `postcss` nested in `next` | **8.4.31** | `next@15.5.23` pins `postcss: "8.4.31"` *exactly*; only an npm `overrides` entry could move it | **NOT EXPOSED.** postcss runs at **build time only**, over CSS this repo authors (`app/globals.css` + Tailwind output). All four advisories require attacker-controlled CSS or an attacker-controlled `sourceMappingURL`. No user-supplied CSS enters the build. |
| `sharp` | **0.34.5** | `next@15.5.23` declares `sharp: "^0.34.3"`; 0.35.x is outside that range | **NOT EXPOSED.** `sharp` is Next's image-optimizer backend. `next.config.ts:7` sets `images: { unoptimized: true }` and there are zero `next/image` imports, so the optimizer never runs and no attacker-supplied bytes reach libvips. |

**Why not Option B (`overrides`) or C (Next 16).** Both clear all 15, and both
buy exactly these two NOT-EXPOSED items. `overrides` forces versions outside what
`next` declares — unsupported by the maintainer, and `sharp` carries native
bindings. Next 16 is a major migration across 45 pages and 30 route handlers into
a production-deploying `master`. Neither is worth it for two advisories that are
unreachable in this configuration. Held in reserve, not rejected.

**The condition that reopens this.** "Not exposed" describes *today's*
configuration, and the margin is thin: adding a single `"use server"` directive
re-opens five of the eight `next` CVEs at once, and removing
`images: { unoptimized: true }` re-arms `sharp`. **Re-run the F-01 exposure check
if either changes** — that is the trigger, and it is the reason the reachability
table in `SECURITY-REVIEW.md` is kept rather than summarised away.

**One caveat carried forward unresolved:** CVE-2026-64648 (cache confusion) is
assessed NOT EXPOSED because the exploit pattern `fetch(new Request(init),
aDifferentInit)` appears nowhere in `app`/`lib`/`components` — but
`@supabase/supabase-js` issues its own requests internally and its source was not
audited. It calls `fetch(url, init)`, so the pattern is unlikely; it is recorded
as **UNVERIFIED** rather than clean.

## A fifth instance of the recurring class, caught in the tooling

`npm install next@15.5.23` **reported success, updated `package.json` and
`package-lock.json` to 15.5.23, and left `node_modules/next` on disk at
15.5.19.** `npm ls next` agreed with the lockfile and printed `next@15.5.23`, so
three of the four places you would look said the upgrade had happened. Only
reading `node_modules/next/package.json` directly showed otherwise. `npm ci` was
required to make the installed tree match the lockfile.

This is the same shape as the rest of this document — *a wrong value producing a
plausible-looking success* — and it is worth recording because a security patch
is exactly where it does the most damage: every artifact you would normally cite
as proof of the upgrade was already correct while the vulnerable code was still
the code that would ship. **Verify a dependency bump by reading the installed
package's own `package.json`, not the manifest, the lockfile, or `npm ls`.**

## Gate

- `tsc --noEmit` → clean (exit 0).
- `npm run build` → green, **117/117** static pages from live data.
- `npm run validate:sql` → 9 files, all parsed clean.
- `npm run smoke` vs `http://localhost:3000` → **ALL GREEN, 69 passed, 0
  failed**, including the five F-09 page↔API agreement checks.

---

# Default privileges — AUDIT.md F-07 (2026-08-11, migration 0009)

`0001_core.sql:806-807` set `alter default privileges in schema public grant
select on tables to anon`, so every table created since inherited anon read
automatically. Four migrations each had to *remember* a compensating `REVOKE`
(0003, 0006 ×2, 0007, 0008). All four remembered, so there was no live defect —
but the default was open, and the failure mode was one forgotten line shipping a
private table to the public internet.

**0009 inverts the default.** New tables created by `postgres` in `public` now
grant `anon` nothing; a public table must be granted deliberately.

## Everything below came from live catalog queries, not the migration files

That distinction is the whole point of the exercise, and it changed the design
twice.

**There are TWO default-ACL entries for `public` tables, owned by different
roles.** `pg_default_acl` before 0009:

| owning_role | acl for anon | meaning |
|---|---|---|
| `postgres` | `rDxtm` | SELECT, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN |
| `supabase_admin` | `arwdDxtm` | **everything** |

`ALTER DEFAULT PRIVILEGES` without `FOR ROLE` silently binds to the *current*
role. A role-scoped default that misses the role actually creating tables is a
no-op that reads in review exactly like a fix. So 0009 names `FOR ROLE postgres`
explicitly, justified by live ownership — `postgres` owns **24 of 24** relations
in `public` (21 tables, 3 views, 1 matview; no other owner exists).

**`REVOKE ALL`, not `REVOKE SELECT`.** The live default granted anon `rDxtm`, not
`r`. Revoking only SELECT would have left future tables TRUNCATE-able by anon,
which RLS does not restrain.

## The residual: `supabase_admin`, which this migration cannot close

The `supabase_admin` default ACL is **more permissive** than the one 0009 fixed
(`anon` gets ALL on any table that role creates in `public`), and 0009 leaves it
untouched — provably, not accidentally:

```
pg_has_role('postgres','supabase_admin','MEMBER')  -> false
pg_roles.rolsuper for postgres                     -> false
```

`ALTER DEFAULT PRIVILEGES FOR ROLE` requires membership in that role or
superuser. Running it as `postgres` fails outright and would abort the migration.
**Wrapping it in an exception handler so the migration "succeeds" was rejected**
— that is the soft-failure shape this document is a catalogue of, and it would
have produced a green push that fixed half of what it claimed. The statement is
therefore left in `0009` as a commented block with the evidence for why it
cannot run.

**Live exposure today is nil:** `supabase_admin` owns 0 of the 24 relations in
`public`. This is a latent path, not an active one. Closing it needs a session
as `supabase_admin` (dashboard SQL editor or Supabase support) and is tracked
here rather than pretended away.

## Two relations keep their anon grant deliberately

Both were flagged during the keep-public audit because neither can be tied to an
anonymous read in application code. **Neither was revoked**, because "I could not
find a caller" is not the same as "nothing calls it", and 0009's remit was the
default for *future* tables — not a re-grant pass over existing ones, which is
precisely how 0002's outage was created.

- **`graph_nodes`** (view). Zero references in `app`, `lib`, or `components`. The
  only reader in the repository is `scripts/audit-pages.mjs:83`, an audit script
  — not the site. `/graph` renders from `getGraphPayload`, which reads the five
  base tables directly (`lib/queries/graph.ts:48-55`) and never touches this
  view. It appears to be a leftover from 0001 that the graph implementation
  outgrew. Revoking it would most likely be inert, and would also break that
  audit script for no gain. **Left public; a candidate for deletion rather than
  revocation, decided separately.**
- **`profiles`** (table). `anon` holds the grant, but the RLS predicate is
  `((id = auth.uid()) OR is_admin())`, and an anonymous request has no
  `auth.uid()` — so anon reads zero rows no matter what the grant says. Every
  code path is authenticated (`lib/api.ts:56,86`, `app/admin/layout.tsx:24`,
  `app/contribute/layout.tsx:26`). The grant is functionally dead, and RLS is the
  thing actually protecting the table. **Left public** because removing a grant
  whose only effect is currently nil is pure risk with no security gain; if it is
  ever revoked, RLS must remain the primary control, not the grant.

## The TRUNCATE bits — ACCEPTED with reasoning, not fixed (2026-08-11)

`anon` holds more than SELECT on the 19 readable relations: the ACL is `rDxtm` —
SELECT, **TRUNCATE**, REFERENCES, TRIGGER, MAINTAIN. RLS does not restrain
TRUNCATE. Before scoping a migration for it, one question had to be answered:
**where do those bits come from?** The answer decided that there should be no
migration.

### They are Supabase platform-authored, not ours — three independent proofs

1. **`grant select` yields `r` alone. Measured, not reasoned.** A table created
   as `postgres` (post-0009 it inherits nothing for `anon`), then granted select:
   ```
   f07_bits_probe | {postgres=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,
                     service_role=arwdDxtm/postgres,anon=r/postgres}
   ```
   `anon=r`, not `rDxtm`. Probe dropped; nothing left behind. Every anon grant we
   author is `grant select`. All 10 `grant all` statements across all migrations
   target **`service_role`, never `anon`**, and no grant of
   TRUNCATE/REFERENCES/TRIGGER/MAINTAIN to `anon` exists anywhere. There is also
   no revoke of INSERT/UPDATE/DELETE from `anon`, so the absent `a`,`w`,`d` were
   never granted — not granted-then-removed.
2. **A schema we have never written to carries the same signature.** The
   `postgres`-owned default ACL for `storage` tables is
   `{… anon=arwdDxtm/postgres …}`; no migration here touches `storage`. The
   airtight case is the `supabase_admin`-owned entry for `public`
   (`anon=arwdDxtm`), which our migrations **cannot** have authored —
   `postgres` is not a member of `supabase_admin`, so it cannot execute the
   statement that creates it. The platform demonstrably authors default ACLs
   granting `anon` broad rights.
3. **`citation_checks` (0008) is identical to `domains` (0001).** Seven
   migrations apart, and `citation_checks`'s only anon statement is
   `grant select … to anon` — which proof 1 shows yields `r`. Both carry
   `rDxtm`, as do all 19, regardless of creating migration. The extra bits
   arrive at `CREATE TABLE` from the default ACL, not from anything we wrote.

Confirmed by subtraction against our own block (`0001_core.sql:805-811`): we
grant defaults of `select` to `anon`, `select, insert, update, delete` to
`authenticated`, `all` to `service_role`. Yet `Dxtm` shows up on **both** `anon`
and `authenticated` — two roles we granted it to neither. `0001:790-792` already
said as much: *"Supabase normally sets these via default privileges."*

### `authenticated` has the same bits, and is the more privileged role

`authenticated` is `arwdDxtm` on **all 24** relations, from the same platform
source. It is held by real logged-in contributors rather than anonymous
visitors, so if these bits were reachable it would be the **larger** exposure —
not a footnote to the anon case. Any future remediation must cover both roles or
it addresses the smaller half.

### Why accepted rather than fixed

- **Not exploitable.** PostgREST exposes no TRUNCATE verb; there is no route
  from an anon *or* authenticated API key to that privilege.
- **Not caused by us.** The three proofs above.
- **Not closable by us while the `supabase_admin` default stands.** It still
  grants `anon` `arwdDxtm` on anything that role creates in `public`, and
  `postgres` cannot alter it. A revoke pass cleans today and leaves tomorrow
  open.
- **The cure is worse than the disease.** Revoking means altering grants on
  existing tables — precisely the operation that caused the 0002 outage. Paying
  that risk for **zero reachable** reduction in exposure is a bad trade.

This is a deliberate, reasoned acceptance. It is recorded here so that a future
`\dp` or ACL audit showing `rDxtm` is a **known state**, not a fresh discovery.

## The canary — 0009 cannot be silently reverted

The platform authored those default entries once, so it can author them again.
0009 removed `anon` from the `postgres`-owned default ACL. **If platform tooling
re-applies its baseline, 0009 is undone, every new table is anon-readable again,
and none of the other 86 smoke checks notice** — they assert public reads still
*work*, never that anon's rights stayed *absent*. It would surface only when
someone adds a private table and finds it already public.

`scripts/smoke.ts` now asserts the `postgres`-owned default ACL for `public`
tables contains no `anon=` entry. `pg_default_acl` is not in a PostgREST-exposed
schema, so this goes through the Management API — which means the check needs
`SUPABASE_ACCESS_TOKEN`, **a platform-admin credential strictly more privileged
than anything else smoke uses**. That cost is recorded rather than slipped in.
Missing credentials is a FAILURE, not a skip.

**Negative-controlled, permanently.** A guard that cannot fail is worth nothing.
`storage` is a schema this repository has never written to whose
`postgres`-owned default genuinely contains an `anon=` entry — a real positive
case that requires granting nothing and leaves nothing behind. The canary's
exact predicate against both:

```
public   -> canary PASS   contains anon= : false
storage  -> canary FAIL   contains anon= : true
```

That control is **wired into smoke as a permanent self-test**, not run once and
discarded, because the failure mode that matters is the canary going *blind*: if
the Management API changes shape or the regexp stops matching, the self-test
fails and says so, instead of the canary passing because it can no longer see
anything.

## Verified after the push, in this order

1. **`pg_default_acl`** — the `postgres` entry no longer lists `anon` at all
   (`{postgres=…,authenticated=…,service_role=…}`); the `supabase_admin` entry is
   byte-identical to before, as predicted.
2. **All 17 keep-public relations still hold anon SELECT**, checked via
   `pg_class.relacl` + `has_table_privilege` so the matview `dashboard_stats` was
   covered — it does not appear in `information_schema.role_table_grants` at all,
   which is exactly how it would have been missed.
3. **`verify-agents.mjs` → ALL GREEN, 38/0**, including `anon can read
   agent_public` and the four `anon cannot read …` denials.
4. **`smoke` vs production → ALL GREEN**, no page serving 200 with empty content.
5. **Behavioural proof, not catalog-reading.** Created a throwaway table as
   `postgres`, and `anon` had **no** privilege on it — SELECT, INSERT, UPDATE,
   DELETE, TRUNCATE, REFERENCES, TRIGGER all `false`, with `authenticated`
   SELECT `true` as a control — then dropped it and confirmed removal. Before
   0009 that table would have been created with `anon=rDxtm`. The catalog change
   and the behaviour change were verified separately because the first does not
   imply the second.

## The guard that makes a regression non-silent

`scripts/smoke.ts` gained 17 assertions (69 → 86 checks) that ask PostgREST, with
the anon key, whether each keep-public relation is still readable. It tests the
**privilege**, so 0 rows is a pass — content is already covered by the route
assertions.

This matters most for the four *embedded* relations — `sources`,
`hypothesis_evidence`, `confidence_history`, `simulation_runs` — which no route
marker covers. If anon lost read on those, the affected pages would still render
and still return 200, just with a sub-section quietly missing. That is the 0002
shape again, one level down.

Two design choices, both learned from this document:

- **Missing credentials is a FAILURE, not a skip.** A guard that quietly does
  nothing when it cannot run would report ALL GREEN having checked nothing.
- **The assertion was negative-controlled**, because a check that cannot fail is
  worth nothing. Against relations anon must not read, the same request returns
  **HTTP 401 / SQLSTATE 42501** (`agents`, `suggestions`, `agent_tokens`), while
  `domains` returns 200 with rows. The check discriminates, and it labels a
  42501 explicitly as `GRANT REVOKED`.
