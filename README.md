# VERITAS

> An observatory for knowledge — a living map of what humanity knows, suspects,
> and cannot yet answer. Every claim carries its epistemic status, a confidence
> score with a recorded rationale, and the evidence for and against it.

Veritas is a Next.js 15 + Supabase application implementing the V1.0 blueprint
in [`veritas-architecture-v1.md`](./veritas-architecture-v1.md). The database —
not the application code — enforces the epistemic rules: a speculation can
never be stored as established knowledge, confidence never changes without a
recorded rationale, and history is append-only and automatic.

---

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router, RSC, ISR) · TypeScript |
| Styling | Tailwind CSS 3 with CSS-variable design tokens |
| Data | Supabase — PostgreSQL (RLS, triggers, FTS, materialized views), Auth, Storage |
| Charts | Recharts |
| Graph | d3-force on `<canvas>` |
| Hosting | Vercel |

---

## Quick start (clone → running locally)

### 1. Prerequisites

- **Node.js ≥ 18.18** (built and tested on Node 24)
- **npm**
- A **Supabase** project (free tier is fine) — [supabase.com](https://supabase.com)
- Optionally the **Supabase CLI** + **Docker** for a fully local database

### 2. Install

```bash
git clone <your-repo-url> veritas
cd veritas
npm install
```

### 3. Configure environment

Copy the template and fill in your Supabase values:

```bash
cp .env.example .env.local
```

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key   # server-only, never exposed
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

All three Supabase values are in **Supabase Dashboard → Project Settings → API**.

> The app ships with placeholder fallbacks so `npm run build` succeeds with no
> credentials — but pages render empty until a real database is connected.

### 4. Set up the database

You can apply the schema and seed either with the Supabase CLI or by pasting
SQL into the dashboard.

#### Option A — Supabase Dashboard (no local tooling)

1. Open **Supabase Dashboard → SQL Editor**.
2. Paste the entire contents of [`supabase/migrations/0001_core.sql`](./supabase/migrations/0001_core.sql) and **Run**.
3. Paste the entire contents of [`supabase/seed.sql`](./supabase/seed.sql) and **Run**.

> [`supabase/migrations/0002_fix_rls.sql`](./supabase/migrations/0002_fix_rls.sql)
> is already mirrored into 0001 — it only needs to be applied (it is idempotent)
> to databases created before the GRANT/RLS fix. The CLI flow below applies both
> automatically.

#### Option B — Supabase CLI (local Postgres via Docker, or linked project)

```bash
# Local stack (requires Docker):
supabase start
supabase db reset            # applies migrations in supabase/migrations
psql "$(supabase status -o env | grep DB_URL | cut -d= -f2-)" -f supabase/seed.sql

# Or against a linked remote project:
supabase link --project-ref YOUR-PROJECT-REF
supabase db push             # applies the migration
# then run supabase/seed.sql in the SQL editor, or:
psql "YOUR-DB-CONNECTION-STRING" -f supabase/seed.sql
```

After seeding you should have **10 domains, ~20 questions, ~30 evidence
entries, 15 hypotheses**, a populated dashboard, and at least one detected
contradiction.

### 5. Run

```bash
npm run dev
# http://localhost:3000
```

---

## Provision the first admin

Public signup is disabled by design (§4.2) — admins are provisioned manually.

1. In **Supabase Dashboard → Authentication → Users → Add user**, create a user
   with an email + password (mark "Auto Confirm" so no email step is needed).
   A `profiles` row is created automatically by the `on_auth_user_created`
   trigger, defaulting to the `public` role.
2. Promote that user to admin in the **SQL Editor** (the one-liner):

   ```sql
   update profiles set role = 'admin'
   where id = (select id from auth.users where email = 'you@example.com');
   ```

3. Sign in at **`/login`**. You now have access to **`/admin`**.

From the admin area you can create domains, questions, hypotheses, and
evidence; link evidence supportively or oppositionally; change confidence (a
rationale is mandatory and recorded); run the contradiction scan; and refresh
the dashboard statistics.

---

## AI research agents (Post-1.0 Phase B)

AI agents are **primary researchers, not writers**. An agent is just another
contributor: it **proposes** hypotheses, evidence, and contradiction findings
into the Phase A suggestion queue (`actor_type='agent'`), through the same Zod
validation, the same `apply_suggestion()` path, the same epistemic constraints
and audit trail as a human — and **a human admin approves every proposal** before
anything joins the live map. Agents can never write to the knowledge tables and
can never self-approve (enforced in Postgres, not app code). Prompt injection in
a source can, at worst, produce a *pending* proposal a reviewer rejects.

### Model provider — local by default, $0 per call

The provider is chosen entirely by environment, so cloud↔local is config-only:

| `VERITAS_LLM_PROVIDER` | Target | Cost |
|---|---|---|
| `openai-compatible` **(default)** | local **Ollama** (`http://localhost:11434/v1`, `qwen2.5:14b`) | **$0 / call** |
| `anthropic` | Claude (cloud) | metered — **off unless selected** |
| `openai` | OpenAI (cloud) | metered — **off unless selected** |

The cloud adapters exist but are reachable **only** by explicitly setting
`VERITAS_LLM_PROVIDER`; a cloud provider without `VERITAS_LLM_API_KEY` throws, so
nothing can bill unless you deliberately switch. See `.env.example` for all knobs.

### Triggering a run (on-demand, bounded)

A run is **manual** and does one bounded unit of work, then stops — no loop, no
cron. With a dev server running and Ollama up:

```bash
# 1. Mint a scoped token for an agent (admin action; prints the token ONCE).
node scripts/mint-agent-token.mjs --name research-agent --domains physics

# 2. Hand the token to the runner and trigger a research run.
export VERITAS_AGENT_TOKEN="veagt_…"            # (PowerShell: $env:VERITAS_AGENT_TOKEN="…")
node scripts/run-research-agent.mjs --domain physics --max-proposals 5 \
  --base-url http://localhost:3000

# Or research a specific question, or scan for contradictions:
node scripts/run-research-agent.mjs --question hard-problem-consciousness
node scripts/run-contradiction-agent.mjs --domain physics

# Preview without writing anything:
node scripts/run-research-agent.mjs --domain physics --dry-run
```

Per-run caps (`--max-model-calls` / `--max-proposals` / `--max-output-tokens`, or
`AGENT_MAX_*` env; defaults 8 / 5 / 50000) bound a single run; the server also
enforces each agent's `max_pending` / `max_per_hour` / domain scope in Postgres.

**What you'll see:** the proposals land in **`/admin/suggestions`** as `pending`
rows labelled `agent: research-agent`, each with its rationale, proposed fields,
and (for evidence) a "link on approval" note. Approve or reject them there; an
approved proposal is credited to the **agent** on the public timeline.

## Deploy to Vercel

1. Push the repo to GitHub/GitLab/Bitbucket.
2. In **Vercel → New Project**, import the repo (framework auto-detected as
   Next.js).
3. Add the four environment variables from `.env.local` to **Project Settings →
   Environment Variables** (set `NEXT_PUBLIC_SITE_URL` to your production URL,
   e.g. `https://veritas.vercel.app`).
4. In **Supabase → Authentication → URL Configuration**, add your Vercel URL to
   the allowed redirect URLs (e.g. `https://your-app.vercel.app/auth/callback`).
5. **Deploy.** Preview and production builds both work with the same variables.

Public pages use ISR; admin writes call `revalidatePath`/`revalidateTag`, so the
public site reflects changes within seconds of an admin save.

---

## Project scripts

```bash
npm run dev            # local dev server
npm run build          # production build (must pass clean before every commit)
npm run start          # serve the production build
npm run typecheck      # tsc --noEmit
npm run validate:sql   # parse migration + seed against the real Postgres grammar
```

### Verification scripts (run with `node`, need `.env.local`)

```bash
node scripts/audit-pages.mjs    # every public route's exact query against the
                                # live DB through the anon client — fails on
                                # any empty or erroring data path
node scripts/diagnose-rls.mjs   # anon vs service-role comparison for
                                # diagnosing RLS/GRANT problems
node scripts/contrast.mjs       # WCAG AA contrast audit of the signal palette
                                # on both themes (pure computation, no DB)
node scripts/verify-admin.mjs   # end-to-end admin WRITE path over real HTTP:
                                # create/edit/link/confidence/scan, auth and
                                # epistemic-guard negative cases, full cleanup.
                                # Needs a running server; set BASE_URL
                                # (default http://localhost:3210)
node scripts/verify-suggestions.mjs # Phase A queue: propose/approve/reject/
                                # withdraw + RLS/authz negatives (needs 0003+0004)
node scripts/verify-agents.mjs  # Phase B agent layer: token authz, propose→
                                # pending→admin-approve→credited-to-agent, and the
                                # server caps (max_pending/max_per_hour/scope).
                                # Needs a running server + migrations 0005+0006.
```

---

## How the epistemics are enforced (the §10 invariants)

These are guaranteed by the **database**, so a buggy client — or a future AI
agent — cannot violate them:

1. **No status exceeds its confidence.** The `epistemics_consistent` CHECK
   constraint binds each `epistemic_status` to a confidence band.
2. **No confidence change without a rationale.** A `BEFORE UPDATE` trigger
   rejects empty rationales and writes an immutable `confidence_history` row.
3. **History is append-only and automatic.** Security-definer triggers write
   `timeline_events` on every meaningful change; the table has no UPDATE/DELETE
   policy.
4. **Reads are safe by default; writes are triple-gated** (middleware →
   handler role check → RLS) and attributed to an actor.
5. **Unknown is grey, never red** — not knowing is a state of the map, not an
   error. The signal palette is reserved exclusively for epistemic state.

---

## Project structure

```
app/
  (public)/      public pages — home, dashboard, domains, hypotheses, evidence,
                 questions, timeline, graph, lab, search, notes
  (auth)/        login + OAuth/PKCE callback
  admin/         role-gated CRUD, evidence linker, confidence editor,
                 contradiction review queue
  api/           thin {data,error} route handlers (Zod-validated, three-gate auth)
components/
  epistemics/    EpistemicBadge, ConfidenceMeter, EvidenceBalance, …
  charts/        themed Recharts wrappers
  graph/         d3-force canvas Research Graph
  admin/ ui/ layout/
lib/
  supabase/      browser / server / public / service-role clients + middleware
  queries/       typed data-access layer (one file per entity)
  knowledge-engine/  taxonomy, confidence mirror, contradictions, graph styling
  validations/   Zod schemas shared by forms + API
supabase/
  migrations/0001_core.sql   the full schema (§2) — the contract
  seed.sql                   §8 seed content
types/           database + app-level domain types
```

---

## Notes & decisions

Implementation choices and deviations from the blueprint are logged in
[`DECISIONS.md`](./DECISIONS.md). The SQL is parsed against the real PostgreSQL
grammar (`pg_query` WASM) via `npm run validate:sql`, and both the public read
paths and the admin write path are verified against the live database by the
verification scripts above (see the launch-readiness entry in DECISIONS.md).
