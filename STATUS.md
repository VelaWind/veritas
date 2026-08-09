# STATUS — Post-1.0 build

Rolling status for review between phases. Most recent phase on top.

---

## Phase D — The agent society 🚧 IN PROGRESS (design signed off 2026-08-10)

Design: `DECISIONS.md` → "Phase D" (D.0–D.10), signed off with four answers
recorded there. Implementation runs in the D.10 order, one migration and one
commit per stage.

| Stage | State |
|---|---|
| 1 — roster, status, public profiles (`0007`) | ✅ **shipped & live-verified** |
| 2 — skeptic lane + citation verifier (`0008`) | ✅ **shipped & live-verified** |
| 3 — council (`0009`) | not started |
| 4 — Internal Affairs (`0010`) | not started |
| 5 — site features (debate, confidence-over-time, changelog) | not started |

Migrations 0007 and 0008 are **applied to the linked project** (`supabase db
push`). Every gate is green against the live database:

| Gate | Result |
|---|---|
| `node scripts/verify-agents.mjs` | ✅ **ALL GREEN — 38** (was 19 at Phase B) |
| `node scripts/verify-suggestions.mjs` | ✅ ALL GREEN — 25 (human path unaffected) |
| `npm run build` (live credentials) | ✅ green, 117/117 pages |
| `npm run validate:sql` (9 files) | ✅ green |
| `tsc --noEmit` · `contrast.mjs` | ✅ clean |

The 0007 gate earned its keep: it caught a real regression. The Phase B probe
disabled an agent by writing `enabled: false`, which 0007 made inert — the agent
kept proposing. The check now asserts both halves of the new contract.

### Where stage 3 picks up

The design (DECISIONS §D.3) is signed off and unchanged. Council needs
`0009_council.sql` (`councils`, `council_turns`, both public), a
`run-council.mjs` driving advocate → skeptic → verifier → synthesizer with
reasoning shared between rounds, `/council/[id]` transcripts, and the verdict
landing as an ordinary pending suggestion. Two decisions already made and worth
not re-litigating: a council convened on a **question** proposes against that
question's most contested hypothesis (the B.9 deviation-4 shape, so
`apply_suggestion()` stays untouched), and the transcript passed between rounds
is **budgeted** — per-turn output capped, prior turns included newest-first with
an explicit truncation marker — because 4 roles × 3 rounds silently overflows a
32k local context and the failure looks like reasoning.

A `council` agent identity does not exist yet. It is not one of the eight, so
stage 3 adds it **via the seed script, not a migration** — consistent with
"more domains later by seed".

### ⚠ Other actions that are yours

- **Run `scripts/seed-agent-roster.mjs --with-tokens`** — not yet run. Needs
  `SUPABASE_SERVICE_ROLE_KEY`; creates **eight Supabase auth users** + profiles +
  registry rows. `--dry-run` prints the plan and writes nothing. Only six of the
  eight get tokens: the skeptic and citation-verifier run inside the research
  lane and never authenticate. Until this runs, `/agents` renders its empty
  state — the schema is live but the roster is not seeded.
- **Optional:** set `VERITAS_CROSSREF_MAILTO` to join Crossref's polite pool.
  No API key; Crossref and OpenAlex are both free and keyless.

### Behaviour changes already landed

- **`--max-model-calls` default raised 8 → 16.** The always-on skeptic lane
  spends the *same* budget, so the old default would have halved proposals per
  run. Override with `--max-model-calls` or `AGENT_MAX_MODEL_CALLS`.
- **`enabled` is no longer directly settable.** Since 0007 it is derived from
  `status`; `update agents set enabled = false` is now a no-op. Disable an agent
  with `status = 'suspended'`.
- **`mint-agent-token.mjs` no longer clobbers scopes.** Re-minting a token for a
  rostered agent used to reset `scopes` to CLI defaults — silently turning a
  domain-scoped researcher into an unscoped one. Each field is now overridden
  only when actually passed.

### Cost posture — unchanged, still $0/call

Local Ollama for every new lane; Crossref and OpenAlex are free and keyless. A
council remains the expensive object — ~4N+1 calls, minutes not seconds on a
local 14B model.

---

## Phase B — AI agent layer ✅ IMPLEMENTED & VERIFIED (2026-06-12)

AI agents are now first-class but deliberately under-privileged **contributors**:
they **propose** into the Phase A queue (`actor_type='agent'`), and a human admin
approves every proposal. Built in the B.8 staged order; migrations applied to the
linked project with `supabase db push`. Full design + the deliberate deviations:
DECISIONS.md §B (see **B.9 Implementation log**).

### What shipped, by stage

| Stage | Files |
|---|---|
| 1 — identities, tokens, caps | `0005_agent_role.sql`, `0006_agents.sql` (`agents` + `agent_tokens`, admin-only RLS, `enforce_agent_quota` BEFORE INSERT cap trigger, trust governor); `requireAgent()` in `lib/api.ts`; `POST /api/agent/suggestions`; `scripts/mint-agent-token.mjs` |
| 2 — provider | `scripts/agent-lib/llm.mjs` — one `complete()` interface; openai-compatible (local Ollama, default, **$0/call**) / anthropic / openai, switchable by env only |
| 3 — Research Agent | `scripts/run-research-agent.mjs` + `scripts/agent-lib/*` (caps, epistemics mirror, parsing, transport) |
| 4 — Contradiction Agent | `scripts/run-contradiction-agent.mjs` |
| 6 — verification | `scripts/verify-agents.mjs` |

Stage 5 (B.6 review-UI volume features) is the **only** B.8 item deferred — the
queue UI already renders `agent_name`; batch/cluster/trust-sort are additive.

### Cost posture (your hard requirement: $0 per call)

Default provider is **local Ollama** via the OpenAI-compatible API — no marginal
cost, no key needed. The cloud adapters are present but **off by default and
switchable by env only**; a cloud provider selected without `VERITAS_LLM_API_KEY`
**throws**. Nothing can bill unless you set `VERITAS_LLM_PROVIDER=anthropic|openai`.

### Gates

| Gate | Result |
|---|---|
| `npm run validate:sql` (incl. 0005/0006) | ✅ green |
| `tsc --noEmit` | ✅ green |
| `npm run build` | ✅ green |
| `node scripts/verify-agents.mjs` (live) | ✅ **ALL GREEN — 19/19** |
| `node scripts/verify-suggestions.mjs` (live, Phase A) | ✅ unaffected (human path unchanged) |

### How to trigger a research run

```bash
# 1. Mint a scoped token (admin action; token shown ONCE).
node scripts/mint-agent-token.mjs --name research-agent --domains physics
# 2. Run it (dev server + Ollama up).
export VERITAS_AGENT_TOKEN="veagt_…"
node scripts/run-research-agent.mjs --domain physics --max-proposals 5 --base-url http://localhost:3000
```

Proposals appear in **`/admin/suggestions`** as `pending` rows labelled
`agent: research-agent`. Approve/reject there; an approved proposal is credited to
the **agent** on the public timeline. Full guide: README → "AI research agents".

### ⚠ Only-if-you-go-cloud action (NOT needed for local)

While on local Ollama there is **no spend to cap**. If you ever switch
`VERITAS_LLM_PROVIDER` to a cloud value, set the provider-side hard spend cap
first (Anthropic: dedicated **Workspace** + workspace-scoped key + **monthly spend
limit**; OpenAI: Billing → Limits + project-scoped key) — per-run caps bound a
single run, the provider cap bounds total spend. Console-only; I can't set it here.

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
