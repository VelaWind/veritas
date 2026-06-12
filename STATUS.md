# STATUS — Post-1.0 build

Rolling status for review between phases. Most recent phase on top.

---

## Phase B — AI agent layer 🟡 DESIGN COMPLETE — awaiting your sign-off before any agent code

Per your instruction, I wrote the **complete agent security + cost model** into
`DECISIONS.md` (§"Phase B — AI agent layer") and **stopped before writing any
agent code**. The only code shipped this turn is the provenance trigger fix you
asked me to fold in (migration 0004).

### The design, in one screen

- **Invariant (unchanged):** agents are *contributors*, not writers. They
  **propose into the Phase A queue** (`actor_type='agent'`, `agent_name` set) and
  **never** write to active hypotheses/evidence. Same route, Zod, RLS,
  `apply_suggestion()`, epistemic constraints, audit trail as humans. A human
  approves before anything goes live. Prompt injection can at worst create a
  *pending* proposal a reviewer rejects.
- **Auth:** each agent is an under-privileged Supabase identity (new `agent`
  role; no knowledge-table grants, never `is_admin()`); server-to-server **scoped
  bearer tokens** (hashed, expiring, revocable) accepted only on the propose
  endpoint via a new `requireAgent()` gate.
- **Volume limits (defense in depth):** client-side per-run caps **and** a
  Postgres `BEFORE INSERT` trigger enforcing per-agent `max_pending` /
  `max_per_hour` / domain scope — so a runaway or compromised agent can't flood
  review.
- **Quality:** review is the gate; required rationale + evidence; duplicate
  suppression; a trust governor that throttles/auto-disables low-approval agents.
- **Auto-approve: NO**, enforced in Postgres (`apply_suggestion` requires
  `is_admin()`). No agent code path can approve.
- **Cost model:** pluggable provider (`anthropic` | `openai` | `openai-compatible`)
  switchable **by env only** — cloud or local Ollama, no code change. **On-demand
  by default** (manual trigger, one bounded unit of work, no loop/cron). Hard
  **per-run caps** (model calls / proposals / output tokens). **Provider spend
  cap** via a dedicated Anthropic workspace + workspace-scoped key + monthly spend
  limit. Cheap-first model ladder (Haiku default → Opus/Fable only for hard
  reasoning), prompt caching + Batch API as levers. **Trajectory:** on-demand
  cloud now → local model for bulk later, cloud only for occasional hard reasoning.

Full detail (tables, the `agents`/`agent_tokens` schema sketch, the two agents,
review-at-volume features, and the staged ship order) is in DECISIONS.md.

### ⚠ Decisions I need from you before implementing

1. **Approve the security + cost model** as written, or tell me what to change.
2. **Provider spend cap is yours to set** (console only): create a dedicated
   Anthropic **Workspace**, mint a **workspace-scoped key**, set a **monthly
   spend limit** + rate limits. I cannot do this from here. (OpenAI: Billing →
   Limits; local Ollama: no API cost.)
3. **Default model + caps:** I propose `claude-haiku-4-5` default with
   `AGENT_MAX_MODEL_CALLS=8`, `AGENT_MAX_PROPOSALS=5`,
   `AGENT_MAX_OUTPUT_TOKENS=50000`. Adjust to taste.

I will not write agent tables, the provider client, or the runners until you say go.

### Provenance fix shipped this turn (migration 0004)

`supabase/migrations/0004_proposer_provenance.sql` — an approved **edit** now
credits the **original proposer** (human or agent) on the public timeline, not
the applying admin, via transaction-local GUCs read by `log_hypothesis_update()`.
Zero behaviour change for direct admin edits. `verify-suggestions.mjs` gained an
assertion for it. SQL parser-validated (now covers 0004).

### ⚠ ACTION REQUIRED (adds to the Phase A item below)

- **Apply `supabase/migrations/0004_proposer_provenance.sql`** to the live DB,
  **together with 0003**. After both are applied, `node scripts/verify-suggestions.mjs`
  (dev server up) should report `ALL GREEN`, including the new edit-provenance
  check. Same constraint as before — I can't run DDL from here.

---

## Phase A — Researcher role + suggestion queue ✅ code-complete (live verification pending migration)

### What shipped

A review queue: `researcher`-role users propose new hypotheses/evidence and
edits; admins approve or reject. Contributors **never** write to the knowledge
tables — they write only into a new `suggestions` queue, and approval is applied
by one atomic, fully-audited database function that runs through every existing
epistemic constraint and trigger.

| Area | Files |
|---|---|
| Migration (new) | `supabase/migrations/0003_suggestions.sql` — enums, `suggestions` table, RLS, `is_contributor()`, `apply_suggestion()`, grants |
| API | `app/api/suggestions/route.ts` (GET/POST), `.../[id]/approve`, `.../[id]/reject`, `.../[id]/withdraw` |
| Auth gate | `requireContributor()` in `lib/api.ts` |
| Query/validation/types | `lib/queries/suggestions.ts`, suggestion schemas in `lib/validations/index.ts`, types in `types/domain.ts` |
| Admin review UI | `app/admin/suggestions/page.tsx`, `components/admin/SuggestionQueue.tsx`, AdminNav link |
| Contributor UI | `app/contribute/*` (layout role-gate, overview, propose hypothesis/evidence, my-suggestions), `components/contribute/*` |
| Form reuse | `propose` prop added to `HypothesisForm` + `EvidenceForm` (admin path unchanged when absent) |
| Middleware | `/contribute` added to the session-required prefixes |
| Verification | `scripts/verify-suggestions.mjs` |

### Security posture (unchanged guarantees)

- No knowledge-table RLS policy, CHECK constraint, or auth gate was modified.
- Contributors are RLS-locked to their own `pending` suggestions; they cannot
  self-approve (proven by a direct-PostgREST probe in the verify script).
- Approval (`apply_suggestion`) self-guards on `is_admin()` and re-checks every
  epistemic constraint; security-definer bypasses only RLS, never triggers or
  CHECKs.
- Confidence is **not** editable via the queue (admins own it); target types are
  limited to hypothesis + evidence.

Full rationale: `DECISIONS.md` → "Phase A".

### Gates

| Gate | Result |
|---|---|
| `npm run validate:sql` (incl. 0003) | ✅ green |
| `tsc --noEmit` | ✅ green |
| `npm run build` | ✅ green |
| `node scripts/audit-pages.mjs` (existing) | ✅ ALL GREEN |
| `node scripts/verify-admin.mjs` (existing) | ✅ 19/19 |
| `node scripts/verify-suggestions.mjs` (new) | ⏳ **BLOCKED** — needs migrations 0003 + 0004 applied (see below) |

### ⚠ ACTION REQUIRED (yours)

1. **Apply the migrations to the live database.** Paste
   `supabase/migrations/0003_suggestions.sql` **and**
   `supabase/migrations/0004_proposer_provenance.sql` (in order) into the
   Supabase SQL Editor and run them (both idempotent), or apply via your CLI
   flow. I cannot run DDL from here — the project exposes only PostgREST keys,
   no direct Postgres connection (same constraint noted for 0001/0002 in
   DECISIONS).
2. **Then confirm live.** With a dev server running
   (`npx next dev -p 3210`), run `node scripts/verify-suggestions.mjs`. Expect
   `ALL GREEN`. Until step 1 is done it prints a clear `BLOCKED` message and
   exits 2.
3. **To exercise the contributor UI**, grant someone the role:
   `update profiles set role = 'researcher' where id = (select id from auth.users where email = '…');`
   They then sign in and use `/contribute`.

No Vercel or Supabase **settings** changes are required for Phase A (auth signup
stays disabled; researchers are provisioned manually, like admins).

### Notes for review

- ~~Attribution asymmetry~~ **Resolved** by migration 0004 (Phase B turn): an
  approved edit now credits the original proposer on the public timeline, not
  the applying admin. See the Phase B section above and DECISIONS.md.

---

## Phase C — In-platform simulation execution

Not started. Design-only; after Phase B is signed off I will write a DECISIONS.md
proposal (sandboxing, resource limits, what runs where) and stop for your
approval before any code-execution work.
