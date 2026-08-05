# Veritas

Veritas is a catalogue of knowledge claims. Every hypothesis carries an epistemic
status (`unknown`, `speculation`, `plausible`, `strong_evidence`, `established`),
a 0 to 100 confidence score, the rationale recorded for that score, and the
evidence linked for and against it. What makes it worth reading is where the rules
live: PostgreSQL enforces them, not the TypeScript. A `speculation` cannot be
stored at confidence 90, because a CHECK constraint rejects the row. Confidence
cannot change without a rationale, because a `BEFORE UPDATE` trigger raises. The
audit trail cannot be rewritten, because the history tables have no UPDATE or
DELETE policy. A buggy client, a careless admin, and a future automated writer all
hit the same wall.

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
- Dashboard (confidence distribution, domain activity, open contradictions) from a
  materialized view, and admin CRUD, evidence linking, and confidence editing
  behind a login. No signup route; admins are provisioned by hand.

## Architecture

### The database is the enforcement layer

`supabase/migrations/0001_core.sql` (842 lines) defines 14 tables, 9 enums, 20
indexes, 20 functions, and 17 triggers, with RLS enabled on all 14 tables under 26
policies. The parts worth reading:

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
  through. Nine more lifecycle triggers cover creation, status change, revision,
  evidence link and unlink, note publication, contradiction detection and
  resolution, and simulation completion, so history is a byproduct of the write
  path rather than something callers must remember to do.
- **Derived state is derived in the database.** Linking evidence inserts the
  matching `graph_edges` row (`supports` becomes a supports edge, `opposes` a
  contradicts edge) and unlinking deletes it, both by trigger, so the graph cannot
  drift from the links it depicts. `graph_nodes` unions the five node types
  `with (security_invoker = on)`, so the reader's RLS applies, not the owner's.
- **Search is in the schema, not in a service.** Five tables carry a generated
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

**Migration 0002 is a postmortem.** Public reads came back empty against a live
database. `scripts/diagnose-rls.mjs` showed SQL state 42501, "permission denied for
table", for both `anon` and `service_role`: a missing table-level GRANT, which
Postgres evaluates before RLS runs, so it was never an RLS row-filter problem.
Home-page statistics kept working only because 0001 granted the `dashboard_stats`
matview explicitly and never granted the base tables. `0002_fix_rls.sql` (117
lines) adds the GRANTs and default privileges, makes `is_admin()` null-safe, splits
the public-read policies so the public condition stands alone, and casts
`'system'::actor_type` in `scan_contradictions()`, where a bare literal resolves to
`text` under `SELECT DISTINCT` and would have failed 42804 the first time the scan
found anything. It is idempotent, and every fix is mirrored into 0001 so fresh
installs land in the same state. It is also why `lib/queries/log.ts` exists: the
query layer logs code and message before returning its safe fallback, so a
privilege failure cannot present as a silently empty page again.

### Application layering

About 11,200 lines of TypeScript and TSX across 152 files, with no `any`.

- **Route handlers** (23 under `app/api/`) parse with a Zod schema from
  `lib/validations`, then return the `{ data, error }` envelope from `lib/api.ts`.
  `requireAdmin()` hands back a session-bound client, so writes run under the
  admin's JWT and are attributed.
- **Query layer** (`lib/queries/*`, one file per entity) owns every PostgREST
  select; each function catches errors, logs, and returns an empty fallback. Pages
  consume the hand-written types in `types/domain.ts`, not raw rows.
- **Auth is gated three times:** middleware redirects unauthenticated `/admin/*` to
  `/login`, `app/admin/layout.tsx` re-checks the role server-side, RLS is the last
  gate. API writes swap the layout check for `requireAdmin()`.
- **Public reads use a cookieless anon client** (`lib/supabase/public.ts`), because
  calling `cookies()` forces a route dynamic and would defeat ISR. It sees exactly
  what an anonymous visitor sees under RLS.
- **Rendering** mixes static pages, ISR (1 hour for most public pages, 15 minutes
  for the dashboard), `generateStaticParams` on the six slug routes, and
  `force-dynamic` for admin, search, timeline, and two filtered lists. Admin writes
  call `revalidateEntity()`, hitting the affected paths plus the `graph` and `stats`
  cache tags.
- **No credentials needed to build.** `lib/supabase/env.ts` falls back to
  placeholders, so `next build` prerenders without a database and pages render empty
  states instead of failing.

The front end is Tailwind with CSS-variable tokens and a signal palette reserved for
epistemic state (unknown is grey, never red). `components/graph/ResearchGraph.tsx`
(439 lines) runs d3-force and paints to canvas: device-pixel-ratio scaling,
cursor-anchored zoom, its own hit testing, an inspector on hover and select,
`role="img"` with node and edge counts in the `aria-label`, and a synchronous settle
under `prefers-reduced-motion`. Dialogs and the command palette use a focus trap;
`Tabs` implements the roving-tabindex keyboard pattern.

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router, RSC, ISR), React 19, TypeScript 5.7 |
| Styling | Tailwind CSS 3.4 with CSS-variable design tokens |
| Data | Supabase: PostgreSQL (RLS, triggers, FTS, materialized views) and Auth |
| Validation | Zod 3, shared by the API routes and the hypothesis form |
| Charts, graph | Recharts 2; `d3-force` on `<canvas>` |
| SQL checking | `pg-query-emscripten`, the real PostgreSQL parser as WASM |

## Setup and run

Needs Node 18.18 or newer (the Next 15 floor; developed on Node 22), npm, and a
Supabase project. The Supabase CLI plus Docker are optional, for a local Postgres.

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

Apply the schema and seed, either with the CLI or by pasting `0001_core.sql`, then
`0002_fix_rls.sql`, then `seed.sql` into the dashboard SQL editor. 0002 is folded
into 0001 already, so it only matters for databases created before that fix, and it
is idempotent either way.

```bash
supabase start && supabase db reset      # local Postgres via Docker, both migrations
psql "$(supabase status -o env | grep DB_URL | cut -d= -f2-)" -f supabase/seed.sql

# or a linked project:
supabase link --project-ref YOUR-PROJECT-REF && supabase db push
psql "YOUR-DB-CONNECTION-STRING" -f supabase/seed.sql
```

The seed loads 10 domains, 20 questions, 15 hypotheses, 31 evidence entries over 31
sources, 47 links, 5 simulations, and 3 notes, then refreshes `dashboard_stats` and
runs the contradiction scan.

For the first admin, add a user in Supabase Dashboard, Authentication, Users with
Auto Confirm on (the `on_auth_user_created` trigger makes the `profiles` row at role
`public`), promote it, then sign in at `/login`.

```sql
update profiles set role = 'admin'
where id = (select id from auth.users where email = 'you@example.com');
```

`npm run dev` serves on http://localhost:3000.

## Verification

There is no test framework. Verification is by script, split by what a reviewer can
reproduce. With no database and no credentials:

```bash
npm run typecheck          # tsc --noEmit, exits 0
npm run validate:sql       # parses both migrations and the seed against the real
                           # PostgreSQL grammar: 149 + 33 + 14 statements clean
node scripts/contrast.mjs  # 8 palette pairs, two surfaces, both themes,
                           # WCAG AA thresholds: all pass
npm run build              # succeeds with zero environment variables set, though
                           # next/font/google needs network access at build time
```

The other three scripts drive a live Supabase project, and two also need the server
running, so a reviewer without credentials cannot reproduce them. These results are
from the author's own runs.

- `scripts/verify-admin.mjs` (204 lines, 19 checks) provisions a temporary admin
  with the service-role key, forges the chunked `@supabase/ssr` auth cookie, and
  drives the real HTTP routes: create, edit, link and unlink evidence, change
  confidence, scan. It asserts the negative cases (401 unauthenticated, 422 for a
  missing or blank rationale, out-of-band confidence rejected by the database
  guard), the trigger side effects (graph edge created then removed,
  `confidence_history` row written with the right old and new values), and RLS draft
  invisibility, then removes everything it created. The probe runs in
  `state='draft'`, and the scan runs only once it is gone so it cannot pair probe
  data with seeded rows.
- `scripts/audit-pages.mjs` replays 21 public read paths through the anon client
  using the exact PostgREST selects the pages use, embeds included, plus the
  `global_search` and `suggested_confidence` RPCs, failing on any error or zero-row
  result.
- `scripts/diagnose-rls.mjs` compares `anon` against `service_role` per table. This
  found the 42501 GRANT bug behind migration 0002.

## Known limits

- No unit or component tests, no test framework, no CI. The scripts above are run by
  hand.
- No ESLint or Prettier config and no lint script; style is not tool-enforced.
- The query layer casts PostgREST results with `as unknown as T` in 11 places, and
  the runtime clients are not generic over a generated `Database` type, so a select
  whose shape stops matching `types/domain.ts` will not fail `tsc`. That is a
  deliberate tradeoff, keeping `types/database.types.ts` non-load-bearing so
  regenerating it can never break the build; the cost is that this class of mismatch
  surfaces at runtime through the scripts above, not at compile time.
- The research graph is pointer-only. No keyboard navigation between nodes.
- The `/api/search` rate limiter is an in-memory token bucket, so it is per-instance
  and does not hold across serverless instances. A soft control.
- The live-database results (19 admin checks, 21 read paths) rest on the author's own
  runs against a seeded Supabase project. Nothing in the repo proves them.
- Not deployed anywhere. There is no public URL.

## Further reading

- [`veritas-architecture-v1.md`](./veritas-architecture-v1.md): the V1.0 blueprint
  this targets. Schema, rendering strategy, the API route table, and the section 10
  invariant list the database is built to enforce.
- [`DECISIONS.md`](./DECISIONS.md): running log of implementation choices and
  deviations, including spec bugs found while writing the migration, the 0002
  postmortem, and the launch-readiness pass.
