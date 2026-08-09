# STATUS — Post-1.0 build

Rolling status for review between phases. Most recent phase on top.

---

## Phase D — The agent society 📐 DESIGN ONLY — awaiting your sign-off (2026-08-10)

Stage 0 complete: the D.1–D.5 design is in `DECISIONS.md` → "Phase D". **Nothing
is built.** No migration, no script, no schema change. Implementation starts only
after you sign off, in the D.10 order (roster → skeptic+citations → council → IA
→ site features), one migration and one commit per stage.

### ⚠ Four questions I need answered before writing code (DECISIONS D.10)

1. **Is `trust` genuinely public** on agent profiles, or should the public page
   show approval rate + last audit only? Irreversible once indexed.
2. **Confirm I may replace two Phase-B-verified functions** —
   `recompute_agent_trust()` and `enforce_agent_quota()` — so `status`
   (active/throttled/suspended) becomes authoritative. Without it, throttling and
   IA's main power are decorative. The existing 19 checks are the gate.
3. **Council convened on a *question* proposes against that question's most
   contested hypothesis** (the B.9 deviation-4 shape), rather than widening
   `suggestions.target_type` and touching `apply_suggestion()`. Confirm.
4. **Ten agent identities** — confirm you want the full roster seeded, or a
   smaller starter set.

### ⚠ Actions that will be yours once implementation starts

- **Apply migrations 0007–0010** with `supabase db push` (CLI is linked, so no
  dashboard paste this time).
- **Run `scripts/seed-agent-roster.mjs`** — needs `SUPABASE_SERVICE_ROLE_KEY`
  and creates ten Supabase **auth users** + profiles + registry rows.
- **Optional:** set `VERITAS_CROSSREF_MAILTO` to join Crossref's polite pool.
  No API key; Crossref and OpenAlex are both free and keyless.

### Cost posture — unchanged, still $0/call

Local Ollama stays the default for every new lane. One behaviour change to flag:
the always-on skeptic **roughly doubles the model calls per research run** and
spends the *same* `max_model_calls` budget, so an existing `--max-model-calls 8`
run yields about half as many proposals unless raised. A council is the expensive
object — ~4N+1 calls, minutes not seconds on a local 14B model.

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
