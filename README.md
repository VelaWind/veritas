# Veritas

Veritas is a catalogue of knowledge claims. Every hypothesis carries an epistemic
status (`unknown`, `speculation`, `plausible`, `strong_evidence`, `established`),
a 0 to 100 confidence score, the rationale recorded for that score, and the
evidence linked for and against it. The rules live in PostgreSQL, not in the
TypeScript. A `speculation` cannot be stored at confidence 90, because a CHECK
constraint rejects the row. Confidence cannot change without a rationale, because a
`BEFORE UPDATE` trigger raises. The audit trail cannot be rewritten, because the
history tables have no UPDATE or DELETE policy. A buggy client, a careless admin,
and an automated writer all hit the same wall.

![The Veritas Reality Dashboard in the dark theme, showing seeded data. A row of five
tiles reads 15 hypotheses, 31 evidence entries, 15 open questions, 5 open
contradictions and 3 simulation runs. Below them, a bar chart of hypotheses per
confidence band shows 1 in 0 to 20, 10 in 21 to 40, 4 in 41 to 60 and none above 60,
and a horizontal bar chart shows hypotheses per domain across the ten domains. The
open contradictions and recent change panels begin at the bottom edge.](docs/dashboard-dark.png)

## The dashboard and the AI research agents

**Dashboard.** `/dashboard` reports what the map holds: hypothesis, evidence, open
question, open contradiction and simulation run counts, the number of hypotheses in
each confidence band, hypotheses per domain, the open contradictions, and the latest
timeline entries. The figures come from `dashboard_stats`, a plain database view
(migration 0015) declared `security_invoker = on`, so each reader sees counts under
their own row-level security and the figures cannot go stale.

**AI research agents.** Agents read sources and propose hypotheses, evidence and
contradiction findings. They do not write to the knowledge tables. Every proposal
enters the same `suggestions` queue a human contributor uses, and an admin approves
or rejects it. The roster in `scripts/seed-agent-roster.mjs` defines 9 agents: five
domain researchers, a skeptic that attaches a critique to each research proposal, a
citation verifier that checks citations against Crossref and OpenAlex, an Internal
Affairs auditor, and a council in which four roles (advocate, skeptic, verifier,
synthesizer) argue a contested claim in a public transcript. The default model is
`qwen2.5:14b` on a local Ollama server; cloud providers run only when selected in the
environment.

What the database enforces on agents:

- A proposal is inserted with status `pending`. A contributor's row-level security
  policy allows only `pending` or `withdrawn` on their own rows, so no proposer can
  approve their own work, and `apply_suggestion()` raises unless the caller is an admin.
- `trg_enforce_agent_quota` runs `BEFORE INSERT` on `suggestions` and raises when an
  agent is suspended, is outside its domain scope, is at its pending cap, or has
  exceeded its hourly cap. A runner that skips its own client-side limits still hits
  these.
- `trg_councils_verdict_shape` rejects a council verdict that points at anything other
  than a hypothesis.
- `ia_apply_sanction()` accepts only `throttle` or `suspend`, requires a reason, and
  refuses any change that is not strictly more restrictive. Reinstatement is not
  expressible through it; only an admin can reinstate.

## Features

- Hypotheses, questions, evidence, sources, and domains, cross-linked. Evidence
  attaches with a relation (supports, opposes, neutral) and a weight.
- Confidence meter over a per-change history, plus `suggested_confidence()`: an
  advisory score from evidence weight, strength, and source reliability.
- `scan_contradictions()` flags hypothesis pairs drawing opposite conclusions from
  the same evidence, with an admin review queue.
- A timeline of every meaningful write, produced by triggers, not by app code.
- Research graph: d3-force layout on `<canvas>`, with click inspection.
- Full-text search over five entity types, weighted ranking, highlighted snippets.
- Dashboard and AI research agents, described above.
- Admin CRUD, evidence linking, confidence editing, and a review queue for proposals,
  behind a login. No signup route; admins are provisioned by hand.

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router, RSC, ISR), React 19, TypeScript 5 |
| Styling | Tailwind CSS 3.4 with CSS-variable design tokens |
| Data | Supabase: PostgreSQL (RLS, triggers, full-text search, views) and Auth |
| Validation | Zod 3, shared by the API routes and the hypothesis form |
| Charts, graph | Recharts 2; `d3-force` on `<canvas>` |
| SQL checking | `pg-query-emscripten`, the PostgreSQL parser compiled to WASM |
| Agent models | Ollama (local, default); Anthropic or OpenAI when selected |
| CI | GitHub Actions |

## Setup and run

Needs Node 18.18 or newer (the Next 15 floor; CI runs Node 24), npm, and a Supabase
project. The Supabase CLI plus Docker are optional, for a local Postgres.

```bash
git clone <repo-url> veritas && cd veritas
npm install && cp .env.example .env.local
```

Fill `.env.local` from Supabase Dashboard, Project Settings, API. The app builds and
serves without these values, but every page will be empty.

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key   # server only, never exposed
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

Apply the 15 migrations in `supabase/migrations/` in order, then `supabase/seed.sql`.

```bash
supabase start && supabase db reset      # local Postgres via Docker, all migrations
psql "$(supabase status -o env | grep DB_URL | cut -d= -f2-)" -f supabase/seed.sql

# or a linked project:
supabase link --project-ref YOUR-PROJECT-REF && supabase db push
psql "YOUR-DB-CONNECTION-STRING" -f supabase/seed.sql
```

The seed loads 10 domains, 20 questions, 15 hypotheses, 31 evidence entries over 31
sources, 46 evidence links (34 supporting, 12 opposing), 5 simulations, 3 simulation
runs, and 3 notes, then runs the contradiction scan. `dashboard_stats` is a plain view
and needs no refresh.

For the first admin, add a user in Supabase Dashboard, Authentication, Users with
Auto Confirm on (the `on_auth_user_created` trigger makes the `profiles` row at role
`public`), promote it, then sign in at `/login`.

```sql
update profiles set role = 'admin'
where id = (select id from auth.users where email = 'admin@example.com');
```

`npm run dev` serves on http://localhost:3000.

## Running the research agents

The provider is chosen by environment:

| `VERITAS_LLM_PROVIDER` | Target | Cost |
|---|---|---|
| `openai-compatible` (default) | local Ollama (`http://localhost:11434/v1`, `qwen2.5:14b`) | none per call |
| `anthropic` | Claude (cloud) | metered, off unless selected |
| `openai` | OpenAI (cloud) | metered, off unless selected |

A cloud provider without `VERITAS_LLM_API_KEY` throws, so nothing is billed unless the
provider is switched on purpose. See `.env.example` for all settings.

A run is manual and does one bounded unit of work, then stops. There is no loop and no
cron. With a dev server and Ollama running:

```bash
# 1. Mint a scoped token for an agent (admin action; prints the token once).
node scripts/mint-agent-token.mjs --name research-agent --domains physics

# 2. Hand the token to the runner and trigger a research run.
export VERITAS_AGENT_TOKEN="veagt_..."          # PowerShell: $env:VERITAS_AGENT_TOKEN="..."
node scripts/run-research-agent.mjs --domain physics --max-proposals 5 \
  --base-url http://localhost:3000

# Research one question, or scan for contradictions:
node scripts/run-research-agent.mjs --question hard-problem-consciousness
node scripts/run-contradiction-agent.mjs --domain physics

# Preview without writing anything:
node scripts/run-research-agent.mjs --domain physics --dry-run
```

Per-run caps (`--max-model-calls`, `--max-proposals`, `--max-output-tokens`, or the
`AGENT_MAX_*` variables; defaults 16, 5 and 50000) bound a single run. The database
enforces each agent's pending cap, hourly cap and domain scope separately.

Proposals appear in `/admin/suggestions` as `pending` rows labelled with the agent's
name, each with its rationale and proposed fields. An approved proposal is credited to
the agent on the public timeline.

<!-- site:case-study:start -->

## Architecture

### The database is the enforcement layer

The schema is 15 migrations under `supabase/migrations/`. Across all of them,
PostgreSQL parses 23 `CREATE TABLE`, 25 `CREATE TRIGGER` and 45 `CREATE POLICY`
statements, and every table has row-level security enabled. The first migration,
`0001_core.sql` (842 lines), defines 14 tables, 9 enums, 20 indexes, 20 functions and
17 triggers, with 26 policies. The parts that carry the design:

- **Status bound to confidence by CHECK constraint.** `epistemics_consistent`
  holds `unknown` at 20 or below, `speculation` at 40 or below, `plausible` 21 to
  60, `strong_evidence` 61 to 80, `established` at 81 or above. Out-of-band writes
  fail in the database; `translateDbError()` turns the constraint name into a
  readable message.
- **Confidence changes require a rationale and record themselves.**
  `log_confidence_change()` runs `BEFORE UPDATE` on `hypotheses`: if confidence
  changed and the rationale is empty it raises, otherwise it writes a
  `confidence_history` row and a `timeline_events` row with old and new values. No
  application code touches either table.
- **History is append-only.** `timeline_events` and `confidence_history` have a
  SELECT policy and nothing else, so under RLS no application role can alter them;
  the trigger functions are `SECURITY DEFINER`, which is how their inserts get
  through. Further lifecycle triggers cover creation, status change, revision,
  evidence link and unlink, note publication, contradiction detection and
  resolution, and simulation completion, so history is a byproduct of the write
  path rather than something callers must remember to do.
- **Derived state is derived in the database.** Linking evidence inserts the
  matching `graph_edges` row (`supports` becomes a supports edge, `opposes` a
  contradicts edge) and unlinking deletes it, both by trigger, so the graph cannot
  drift from the links it depicts. `graph_nodes` unions the node types
  `with (security_invoker = on)`, so the reader's RLS applies, not the owner's.
- **Search is in the schema, not in a service.** Searchable tables carry a generated
  `tsvector` column with weighted fields and a GIN index. `global_search()` queries
  them with `websearch_to_tsquery`, orders by `ts_rank`, and returns `ts_headline`
  snippets. Since `ts_headline` returns admin-authored text with `<b>` inserted,
  `sanitizeHeadline()` escapes the whole string and re-enables only the `<b>`
  markers before it reaches `dangerouslySetInnerHTML`.
- **`suggested_confidence()` is advisory and damped.** Each link contributes
  `sign(relation) * weight * strength * source_reliability`; the sum is scaled
  around 50, divided by `max(sqrt(count), 1)`, clamped to 0 to 100. The square-root
  divisor stops one strong citation from implying certainty, and the database never
  overwrites the number a human set. `scan_contradictions()` is idempotent: a
  unique constraint on `(hypothesis_a, hypothesis_b, kind)` gives its
  `on conflict do nothing` something to conflict with.
- **Agents get no new write path.** Migrations 0006 to 0011 add agent identities,
  scoped tokens, critiques, citation checks, councils and audits. None of them grants
  an agent admin rights or a route to the knowledge tables; the rules the database
  enforces on agents are listed in the README section on the research agents.

**Migration 0002 is a postmortem.** Public reads came back empty against a live
database. `scripts/diagnose-rls.mjs` showed SQL state 42501, "permission denied for
table", for both `anon` and `service_role`: a missing table-level GRANT, which
Postgres evaluates before RLS runs, so it was never an RLS row-filter problem.
`0002_fix_rls.sql` (117 lines) adds the GRANTs and default privileges, makes
`is_admin()` null-safe, splits the public-read policies so the public condition stands
alone, and casts `'system'::actor_type` in `scan_contradictions()`, where a bare
literal resolves to `text` under `SELECT DISTINCT` and would have failed with 42804
the first time the scan found anything. It is idempotent, and every fix is mirrored
into 0001 so fresh installs land in the same state. It is also why `lib/queries/log.ts`
exists: the query layer logs code and message before returning its fallback, so a
privilege failure cannot present as a silently empty page. The same failure shape
recurred, which `DECISIONS.md` records as a recurring class, so the fallback is now
gated on whether credentials are live at all.

### Application layering

About 15,500 lines of TypeScript and TSX across 188 files, with no `any` in a type
position.

- **Route handlers** (31 under `app/api/`) parse with a Zod schema from
  `lib/validations`, then return the `{ data, error }` envelope from `lib/api.ts`.
  `requireAdmin()` hands back a session-bound client, so writes run under the
  admin's JWT and are attributed.
- **Query layer** (`lib/queries/*`, one file per entity) owns every PostgREST
  select; each function catches errors and logs. Whether it then returns an empty
  fallback or throws depends on `HAS_LIVE_SUPABASE`: with no database configured the
  fallback is the point, and with one configured a failed query is an outage and
  raises to an error boundary. Pages consume the hand-written types in
  `types/domain.ts`, not raw rows.
- **Auth is gated three times:** middleware redirects unauthenticated `/admin/*` to
  `/login`, `app/admin/layout.tsx` re-checks the role server-side, RLS is the last
  gate. API writes swap the layout check for `requireAdmin()`.
- **Public reads use a cookieless anon client** (`lib/supabase/public.ts`), because
  calling `cookies()` forces a route dynamic and would defeat ISR. It sees exactly
  what an anonymous visitor sees under RLS.
- **Rendering** mixes static pages, ISR (1 hour on 15 public pages and the sitemap, 15 minutes
  for the dashboard), `generateStaticParams` on 8 dynamic routes, and `force-dynamic` for
  admin, contribute, search, timeline, and the hypothesis and evidence lists. Admin
  writes call `revalidateEntity()`, hitting the affected paths plus the `graph` and
  `stats` cache tags.
- **No credentials needed to build, except in production.** `lib/supabase/env.ts`
  falls back to placeholders, so `next build` prerenders without a database and pages
  render empty states instead of failing. A production build refuses those
  placeholders and throws: shipping one once served every page at HTTP 200 against an
  unreachable database for about two months, as `DECISIONS.md` records.

The front end is Tailwind with CSS-variable tokens and a signal palette reserved for
epistemic state (unknown is grey, never red). `components/graph/ResearchGraph.tsx`
(469 lines) runs d3-force and paints to canvas: device-pixel-ratio scaling,
cursor-anchored zoom on a non-passive wheel listener so the page cannot scroll
underneath it, its own hit testing, an inspector on hover and select,
`role="img"` with node and edge counts in the `aria-label`, and a synchronous settle
under `prefers-reduced-motion`. Dialogs and the command palette use a focus trap;
`Tabs` implements the roving-tabindex keyboard pattern.

## Verification

**Continuous integration.** `.github/workflows/ci.yml` runs on every push to `master`
and every pull request, in two tiers.

- Tier 1 uses no credentials. It runs `npm run typecheck` (`tsc --noEmit`),
  `npm run lint` (ESLint with the Next.js core-web-vitals and TypeScript rule sets),
  `npm run test:unit`, `npm run validate:sql`, the WCAG contrast audit, and
  `npm run build` with no environment variables set.
- Tier 2 builds with the public Supabase URL and anon key (stored as repository
  variables, not secrets), starts the production server inside the runner, and runs
  `scripts/smoke.ts` against it. The job fails if the smoke run reports fewer than 87
  passing assertions, so a dropped check cannot pass silently.

`.github/workflows/production-smoke.yml` runs the same smoke script against the
deployed site every 30 minutes, read-only and under the anon role.

**What each check covers.** These run with no database and no credentials:

```bash
npm run typecheck      # tsc --noEmit
npm run lint           # eslint .
npm run test:unit      # 73 checks in three files: 25 for sanitizeHeadline (the
                       # search-snippet XSS guard), 31 for the council context
                       # budget, 17 for the Internal Affairs report parser
npm run validate:sql   # parses the 15 migrations and the seed with the PostgreSQL
                       # grammar: 413 statements across 16 files
node scripts/contrast.mjs  # 8 palette pairs, two surfaces, both themes, against
                           # WCAG AA thresholds
npm run build          # succeeds with no environment variables set; next/font/google
                       # needs network access at build time
```

**Scripts that need the live database.** Three scripts write to the database with the
service-role key, so they are not in CI: there is one database and the scripts mutate
it. They are run by hand, and `STATUS.md` records the results.

- `scripts/verify-admin.mjs` (204 lines, 19 checks) provisions a temporary admin,
  forges the chunked `@supabase/ssr` auth cookie, and drives the real HTTP routes:
  create, edit, link and unlink evidence, change confidence, scan. It asserts the
  negative cases (401 unauthenticated, 422 for a missing or blank rationale,
  out-of-band confidence rejected by the database guard), the trigger side effects,
  and RLS draft invisibility, then removes everything it created.
- `scripts/verify-suggestions.mjs` drives the contributor queue over HTTP: propose,
  approve, reject, withdraw, and the RLS and authorization negatives (a contributor
  sees only their own rows; nobody can approve their own).
- `scripts/verify-agents.mjs` drives the agent layer end to end: scoped-token
  authorization, propose to pending to admin approval to credit, the caps enforced in
  Postgres, the skeptic and citation lanes, the council, and Internal Affairs
  sanctions.
- `scripts/audit-pages.mjs` runs 21 read probes through the anon client across 15
  routes (18 PostgREST selects copied from the pages and 3 RPC calls) and fails on any
  error or empty result. `scripts/diagnose-rls.mjs` compares `anon` against
  `service_role` per table; it found the GRANT bug behind migration 0002.

## Known limits

- Unit tests cover three modules. They are plain Node scripts with their own
  assertion helper; there is no test framework and no component or browser tests.
- ESLint has no stylistic rules and there is no Prettier config, so formatting is
  not tool-enforced. `npm run lint` passes with one `react-hooks/exhaustive-deps`
  warning in `ResearchGraph.tsx`.
- The query layer casts PostgREST results with `as unknown as T` in 13 places, and
  the runtime clients are not generic over a generated `Database` type, so a select
  whose shape stops matching `types/domain.ts` will not fail `tsc`. This is a
  deliberate tradeoff that keeps `types/database.types.ts` non-load-bearing, so
  regenerating it can never break the build; such a mismatch surfaces at runtime
  through the smoke and verify scripts instead.
- The scripts that mutate the database (`verify-admin`, `verify-suggestions`,
  `verify-agents`) are not automated, because CI has no disposable database. Their
  recorded results come from the author's own runs.
- CI tier 2 and the production smoke read the production database. Tier 2 fails by
  design on pull requests from forks, because GitHub withholds repository variables
  from them.
- The research graph is pointer-only. There is no keyboard navigation between nodes.
- The `/api/search` rate limiter is an in-memory token bucket, so it is per-instance
  and does not hold across serverless instances.
- Agent runs are manual and need a local Ollama server or a cloud API key.

<!-- site:case-study:end -->

## How this was built

Veritas was built solo by its author in collaboration with Claude Code. The author
makes the decisions: what to build, how the schema enforces it, and what counts as
verified. Claude Code drafts code, migrations and documentation to that direction, and
nothing ships unread. The reasoning behind each decision, including the ones that
were later reversed, is recorded in `DECISIONS.md`.

## Further reading

- [`veritas-architecture-v1.md`](./veritas-architecture-v1.md): the 1.0 blueprint.
  Schema, rendering strategy, the API route table, and the invariant list the database
  is built to enforce.
- [`DECISIONS.md`](./DECISIONS.md): running log of implementation choices and
  deviations, including spec bugs found while writing the migrations, the 0002
  postmortem, and the agent design.
- [`STATUS.md`](./STATUS.md): build history by phase and the latest recorded results
  of every check.
- [`AUDIT.md`](./AUDIT.md) and [`SECURITY-REVIEW.md`](./SECURITY-REVIEW.md): the
  security and engineering audits and how each finding was closed.

## Licence

MIT. See [LICENSE](LICENSE).
