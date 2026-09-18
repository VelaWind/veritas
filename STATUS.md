# STATUS — Post-1.0 build

Rolling status for review between phases. Most recent phase on top.

---

## Phase D — The agent society 🚧 IN PROGRESS (design signed off 2026-08-10)

Design and rationale: `DECISIONS.md` → "Phase D" (D.0–D.10) for the plan, and the
dated stage write-ups that follow it for what each stage actually decided. This
file records only **what is live and what is next**.

| Stage | State |
|---|---|
| 1 — roster, status, public profiles (`0007`) | ✅ shipped & live-verified |
| 2 — skeptic lane + citation verifier (`0008`) | ✅ shipped & live-verified |
| 3 — council (`0010`) | ✅ shipped & live-verified — verdict **deliberately stops before the queue** |
| 4 — Internal Affairs (`0011`) | ✅ schema & sanction live — **no route, no runner, no audit has run** |
| 5 — site features (debate, confidence-over-time, changelog) | not started |

Stage 3 is `0010` and stage 4 is `0011`, not the `0009`/`0010` the D.10 order
originally named: 0009 went to the F-07 default-privileges fix. DECISIONS §D.6 is
corrected.

**Applied to the linked project** (`supabase db push`): 0007, 0008, 0010, 0011,
plus 0009 and 0012 from outside the Phase D sequence, which close the two open
default privileges — 0009 for future tables, 0012 for future functions. 0012 also
revoked the over-grants the old default had already handed out, taking
PUBLIC-executable functions in `public` from 22 to 4 and closing a live
security-definer RLS bypass. Why, and the per-function surface: `AUDIT.md` F-07,
F-11 and §11.

### Gates — all green against the live database, last run 2026-09-05 (after 0012)

| Gate | Result |
|---|---|
| `node scripts/verify-agents.mjs` | ✅ ALL GREEN — **43** (19 at Phase B, 38 at stage 2, 40 → 43 with the D.9 council assertions) |
| `node scripts/verify-suggestions.mjs` | ✅ ALL GREEN — **25** (the human contributor path, unaffected by 0012) |
| `npm run smoke` (against production) | ✅ ALL GREEN — **95** (87 → 93 with `/council/[id]`, 93 → 95 with the truncation marker) |
| `npm run test:unit` | ✅ **56** across two files — 25 `test-sanitize`, 31 `test-council-budget` |
| `npm run validate:sql` (**13** files) | ✅ green |
| `npm run build` (live credentials) | ✅ green, **127/127** pages |
| `tsc --noEmit` · `contrast.mjs` | ✅ clean · ALL PASS |

### What is live

**Stage 3 — council.** `0010_council.sql` (applied 2026-08-27) gives `councils`
and `council_turns`, both public, with `trg_councils_verdict_shape` enforcing the
deviation-4 shape in Postgres rather than by convention.
`scripts/run-council.mjs` drives advocate → skeptic → verifier → synthesizer over
`--rounds N` (default 2), and `/council/[id]` renders the transcript publicly.
**Two** councils are live:

| council | subject | outcome | truncated |
|---|---|---|---|
| `22c63a47` | `dark-matter-is-modified-gravity` | `split` | 0 of 8 |
| `b9d8f7e4` | `life-began-rna-world` | `consensus` | 6 of 8 |

The transcript budget (`buildTranscriptContext`) is covered by 31 mutation-tested
unit assertions with no database and no model; abort was exercised rather than
assumed. Why the budget has a one-turn floor, why the contrast pair exists, and
what the abort test cannot cover: DECISIONS → *Council runner and transcript
page* and *Council follow-ups*.

**Stage 4 — Internal Affairs.** `0011` (applied 2026-09-04) gives `agent_audits`
(admin-only RLS), `ia_apply_sanction()`, and the `agent_status_rank()` ladder.
The sanction ladder is one-way in Postgres — IA can throttle or suspend and
cannot reinstate, and refuses any move that is not strictly more restrictive.
`agent_audits` holds **0 rows**; nothing has run. The `internal-affairs` identity
was seeded at stage 1. Why the ladder is shaped that way: DECISIONS §D.4.

0011 also carried the `councils.context_budget` column and backfilled both
existing councils from what they actually ran at (`b9d8f7e4` at 600, not the 6000
default). That closes the gap DECISIONS recorded as unresolved at the end of
stage 3 — at the schema level only; see below.

### What is next

- **Stage 5 — site features** (debate view, confidence-over-time, changelog),
  specified in DECISIONS §D.5. Not started.
- **Wire the council verdict to the propose route.** Today `suggestion_id` stays
  null, no council needs the `council` identity or a token, and nothing stage 3
  produces can reach `suggestions`. That is the deliberate stop-point, not an
  omission — but it also blocks **D.9 #5** (that a verdict lands `pending` only,
  credited to `council`, changing no hypothesis row), which cannot be asserted
  until the wiring exists.
- **Stage 4 needs its route and its runner.** `app/api/agent/` has `citations`
  and `suggestions` only, and nothing computes the six §D.4 checks. The schema
  already enforces that findings are stored before any model call, so a runner
  cannot quietly invert that ordering.
- **One-line fix: `scripts/run-council.mjs` does not write
  `councils.context_budget`.** The column exists and the two live councils are
  backfilled, but a *new* council records null. Null means "not recorded", which
  is true — the runner is what needs changing.

### ⚠ Actions that are yours

- **Re-run `scripts/seed-agent-roster.mjs --with-tokens`** to provision the ninth
  identity, `council` — added to the seed script but **not yet seeded**
  (`--dry-run` shows 9 agents). The eight from stage 1 were seeded 2026-08-11 and
  are reused by email lookup, not duplicated, so this creates **one** auth user
  and mints **one** token. Needs `SUPABASE_SERVICE_ROLE_KEY`; `--dry-run` prints
  the plan and writes nothing. Two things to know first:
  - **The council's token is unscoped (`scopes.domains: []`)** — the first
    identity that can propose into `suggestions` in *any* domain. `--dry-run`
    prints each agent's scope, so the widening is visible in the plan. Why it is
    structural rather than an oversight, and what still bounds it: DECISIONS →
    *Council identity*.
  - **Re-running does not reinstate anyone.** `status` is deliberately never
    written, so an agent IA or the trust governor suspended stays suspended.
- **The six stage-1 tokens expired 2026-09-10** and are unrecoverable. Mint
  replacements with `scripts/mint-agent-token.mjs --name <agent>`.
- **Optional:** set `VERITAS_CROSSREF_MAILTO` to join Crossref's polite pool. No
  API key; Crossref and OpenAlex are both free and keyless.

### Behaviour changes already landed

- **`--max-model-calls` default raised 8 → 16.** The always-on skeptic lane
  spends the *same* budget, so the old default would have halved proposals per
  run. Override with `--max-model-calls` or `AGENT_MAX_MODEL_CALLS`.
- **`enabled` is no longer directly settable.** Since 0007 it is derived from
  `status`; `update agents set enabled = false` is a no-op. Disable an agent with
  `status = 'suspended'`.
- **`mint-agent-token.mjs` no longer clobbers scopes.** Each field is overridden
  only when actually passed, so re-minting no longer silently turns a
  domain-scoped researcher into an unscoped one.

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
