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
