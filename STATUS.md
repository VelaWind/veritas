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

### Where stage 3 stands

**Schema, runner, and transcript page are live. The verdict does not reach the
queue yet, and that is the deliberate stop-point.**

`0010_council.sql` was applied 2026-08-27 — `councils` and `council_turns`, both
public, plus the enums, the anon grants, and a trigger that enforces the
deviation-4 shape in Postgres. (It is **0010**, not the `0009_council.sql` this
section used to name: 0009 went to the F-07 default-privileges fix, so IA becomes
0011. DECISIONS §D.6 is corrected.)

`scripts/run-council.mjs` drives advocate → skeptic → verifier → synthesizer over
`--rounds N` (default 2), writing each turn as it happens, and `/council/[id]`
renders the transcript publicly. One genuine council is live:
`dark-matter-is-modified-gravity`, 2 rounds, 8 turns, outcome `split`.

**The verdict stops at `councils.verdict`.** `suggestion_id` stays null, no
council needs the `council` identity or a token, and nothing this stage produces
can reach `suggestions`. Wiring it to the propose route is the next step.

**The context budget is proven, not asserted.** `buildTranscriptContext` is a
pure function in `scripts/agent-lib/council.mjs`, exercised directly and then run
for real at `--context-budget 200` so truncation had to occur:
`context_truncated` came back `false` on the two turns where nothing was dropped
and `true` on the other six, while the same council at the default 6000-token
budget truncated nothing. Note it is a budget with a **floor of one turn** — the
newest turn is always included even if it alone exceeds the budget, because a
turn that cannot see the argument before it is not in a debate.

**Abort was made to happen, not assumed.** Forcing a model failure after the
council row was open produced `status='aborted'` with a non-empty
`abort_reason`, as the CHECK requires. What it cannot cover: a hard kill runs no
code, so a stale `running` council remains possible. Running out of model budget
is deliberately `no_verdict` on a **complete** council, not an abort.

Two decisions already made and worth not re-litigating: a council convened on a
**question** proposes against that question's most contested hypothesis (the B.9
deviation-4 shape, so `apply_suggestion()` stays untouched — now enforced by
`trg_councils_verdict_shape`, not by convention), and the transcript passed
between rounds is budgeted, as above.

**The schema is now covered by tests; the runner's promises are not.**
`verify-agents` is **43/43**, having gained the three D.9 assertions that do not
need a council to have run: anon can read both tables (the live counterpart to
0010's guard — since 0009 a new table inherits no anon grant), anon can write
neither, and `trg_councils_verdict_shape` rejects a non-hypothesis link with
`23514`. The third is negative-controlled — it asserts the trigger *accepts* a
hypothesis-targeted link as well as rejecting an evidence-targeted one, because
a check that only asserts the rejection would pass just as well against a
trigger that rejected everything.

`smoke` is **87 → 93**: `councils` and `council_turns` join the F-07 keep-public
list, plus four assertions on `/council/[id]`. That page's id is a runtime uuid,
so unlike every other page spec it **discovers** its target — it asks the public
API for the newest complete council and renders that. A missing council fails
rather than skips.

**What is still unasserted:**

- **D.9 #5** — that a council verdict lands as `pending` only, credited to
  `council`, changing no hypothesis row. It needs the verdict wired to the queue,
  which is deliberately not done yet.
- **The context budget has no repeatable test.** It is proven by a one-off probe
  and a real run, not by a case in `test:unit`. `buildTranscriptContext` is pure
  and would be cheap to cover there.
- **No public council exercises the truncation marker.** The default budget does
  not bind at this transcript length, and the deliberately-tiny-budget council
  used to prove it was deleted rather than left on a public site.

The `council` agent identity is **added to `scripts/seed-agent-roster.mjs` but
not yet seeded** — via the seed script, not a migration, consistent with "more
domains later by seed". `--dry-run` shows 9 agents. See the actions below.

### ⚠ Other actions that are yours

- **Re-run `scripts/seed-agent-roster.mjs --with-tokens`** to provision the
  ninth identity, `council`. The eight from stage 1 were seeded 2026-08-11 and
  are reused by email lookup, not duplicated — this run creates **one** new
  Supabase auth user and mints **one** new token. Needs
  `SUPABASE_SERVICE_ROLE_KEY`; `--dry-run` prints the plan and writes nothing.
  Two things to know before you run it:
  - **The council's token is unscoped (`scopes.domains: []`)** — it is the first
    identity that can propose into `suggestions` in *any* domain. That is
    structural, not an oversight: a council convenes on whichever hypothesis is
    contested. What still bounds it is written up in DECISIONS, *Council
    identity*. The `--dry-run` output now prints each agent's scope, so the
    widening is visible in the plan.
  - **Re-running does not reinstate anyone.** `status` is deliberately never
    written, so an agent IA or the trust governor suspended stays suspended.
  - The six stage-1 tokens **expire 2026-09-10** and are unrecoverable; mint
    replacements with `scripts/mint-agent-token.mjs --name <agent>`.
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
