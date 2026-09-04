# AUDIT — Veritas

Repository audit performed 2026-08-10 at commit `c8ab9ef`.
Report only; no source file was modified.

Every claim below is backed by pasted command output or a `file:line` reference.
Where a claim could not be established from this checkout, it is marked
**UNVERIFIED** rather than concluded.

---

## 1. Command results

| Command | Exit | Result |
|---|---|---|
| `npm ci` | 0 (after cleanup — see F-08) | 261 packages, 4 high-severity vulnerabilities |
| `npx tsc --noEmit` | 0 | no output |
| `npm run lint` | 1 | **script does not exist** |
| `npm run build` | 0 | 117 static pages generated |
| `npm run validate:sql` | 0 | 9 files, 302 statements parsed clean |

### `npm ci`

First invocation failed:

```
npm error code EPERM
npm error syscall unlink
npm error path d:\Veritas\node_modules\@next\swc-win32-x64-msvc\next-swc.win32-x64-msvc.node
npm error [Error: EPERM: operation not permitted, unlink '...next-swc.win32-x64-msvc.node']
=== EXIT: 127 ===
```

Cause: eight orphaned `next` processes were holding the SWC binary (see F-08).
After terminating them:

```
added 261 packages, and audited 262 packages in 21s
4 high severity vulnerabilities
=== EXIT: 0 ===
```

### `npx tsc --noEmit`

```
### npx tsc --noEmit
=== EXIT: 0 ===
```

Clean — no diagnostics emitted.

### `npm run lint`

```
### npm run lint
npm error Missing script: "lint"
npm error To see a list of scripts, run:
npm error   npm run
=== EXIT: 1 ===
```

### `npm run build`

```
   ▲ Next.js 15.5.19
   - Environments: .env.local
 ✓ Compiled successfully in 4.1s
   Linting and checking validity of types ...
   Collecting page data ...
 ✓ Generating static pages (117/117)
   Finalizing page optimization ...
=== EXIT: 0 ===
```

Note the build read `.env.local`, so it ran against the **live Supabase
project**, not a placeholder.

### `npm run validate:sql`

```
✓ supabase/migrations/0001_core.sql — 149 statements parsed clean
✓ supabase/migrations/0002_fix_rls.sql — 33 statements parsed clean
✓ supabase/migrations/0003_suggestions.sql — 24 statements parsed clean
✓ supabase/migrations/0004_proposer_provenance.sql — 2 statements parsed clean
✓ supabase/migrations/0005_agent_role.sql — 1 statements parsed clean
✓ supabase/migrations/0006_agents.sql — 28 statements parsed clean
✓ supabase/migrations/0007_agent_roster.sql — 28 statements parsed clean
✓ supabase/migrations/0008_critiques_citations.sql — 23 statements parsed clean
✓ supabase/seed.sql — 14 statements parsed clean
=== EXIT: 0 ===
```

This parses SQL against the PostgreSQL grammar. It does **not** execute the SQL
and does not check semantics, privileges, or migration ordering.

---

## 2. Findings, ordered by severity

### F-09 — HIGH — A credential-free run poisons the persistent data cache, and a credentialed server then serves empty payloads with HTTP 200

**Status: PARTIALLY RESOLVED — scope corrected 2026-08-11.** M1/M2 (`71d50c7`)
close this vector on the two `unstable_cache` API routes, and that closure still
holds. What the original write-up did not say is that those two routes are not
the only path into `.next/cache/fetch-cache`. Every ISR page reaches the same
persistent cache through Next's **automatic fetch cache**, which no guard
touches — and an instance was observed there on 2026-08-11. Detection in
`scripts/smoke.ts`; exposure bounded by documented environment isolation. Full
closure record and its stated evidentiary limits: **§8.5**. Corrected scope and
the observed instance: **F-09b** at the end of this section, where the ISR path
is now **ACCEPTED WITH REASONING** (2026-08-27): the guard that would have
covered it was evaluated and declined, and detection moved to a scheduled
production smoke.

`unstable_cache` entries are written to `.next/cache/fetch-cache` keyed on the
cache key alone. **Nothing in that key records whether credentials were present
when the value was computed.** So a run with no credentials — where
`HAS_LIVE_SUPABASE` is false and the query layer returns its empty fallback
instead of throwing — writes `null` and `{"nodes":[],"edges":[]}` under exactly
the keys a healthy run would use. Those entries survive a rebuild, and a later
credentialed server serves them as fresh cache hits.

This is the outage shape the whole Phase 2 hardening was written to prevent, and
it evades that hardening completely: nothing fails, so nothing is loud. The
empty value is not an error being swallowed — it is a *successfully computed
fallback* being cached as a legitimate result.

**Severity is HIGH, not MEDIUM, for three reasons:**

1. It is served with **HTTP 200 and a valid `{ data, error: null }` envelope**.
   Every monitor that checks status or JSON validity passes.
2. It persists for the **full revalidate window** — 900s for `/api/stats`,
   3600s for `/api/graph` — not for a single request.
3. The page and the API **disagree**, so the site looks healthy to a human
   browsing it while the API serves nothing.

**Evidence — reproduced end to end, deterministically:**

*Step 1 — a credential-free (preview-style) runtime writes the poison.* Builds
alone do not: API routes are not prerendered, and a credential-free build wrote
**0** entries.

```
PREVIEW-STYLE BUILD (no credentials) EXIT: 0
[veritas:query:listPublicAgentNames] TypeError: fetch failed
fetch-cache entries after build: 0

$ VERCEL=1 VERCEL_ENV=preview npx next start -p 3001
=== /api/stats (no credentials) ===
{"data":null,"error":null}
=== /api/graph (no credentials) ===
{"data":{"nodes":[],"edges":[]},"error":null}
=== fetch-cache entries after those two requests: 2 ===
```

The two entries, verbatim:

```
--- 1c7c4d2b480da6eaa7a978d6040e5195789d072b038baa04ac558c9eebf563f1
{"kind":"FETCH","data":{"headers":{},"body":"null","status":200,"url":""},"revalidate":900,"tags":["stats"]}
--- 60fae050224521052dd1061e068f57d9292418268006a5a33cf0acd88fe076a2
{"kind":"FETCH","data":{"headers":{},"body":"{\"nodes\":[],\"edges\":[]}","status":200,"url":""},"revalidate":3600,"tags":["graph"]}
```

*Step 2 — the poison survives a credentialed rebuild.* `.next/cache` is
preserved across builds by design:

```
CREDENTIALED REBUILD EXIT: 0
 ✓ Generating static pages (117/117)
fetch-cache entries surviving the rebuild: 188
1c7c4d2b480da6ea  {"kind":"FETCH","data":{"headers":{},"body":"null","status":200,...
60fae05022452105  {"kind":"FETCH","data":{"headers":{},"body":"{\"nodes\":[],\"edges\":[]}",...
```

*Step 3 — the credentialed server serves it, while the page shows real data:*

```
=== FIRST request, /api/stats (credentials present) ===
{"data":null,"error":null}  [HTTP 200]
=== FIRST request, /api/graph (credentials present) ===
{"data":{"nodes":[],"edges":[]},"error":null}  [HTTP 200]
=== the PAGE /graph, same server, same moment ===
Research graph: 76 nodes, 99 edges
```

*Step 4 — it is not a one-request blip.* The entries are within their revalidate
window, so they are served as **fresh** hits, not stale-while-revalidate:

```
request 1: {"data":null,"error":null}
request 2: {"data":null,"error":null}
request 3: {"data":null,"error":null}
```

*Original discovery.* This was first seen as an unexplained smoke failure —
`/api/stats` returning `data is null — dashboard_stats never refreshed` and
`/api/graph` returning `0 nodes` on a server whose `/graph` page rendered
`Research graph: 76 nodes, 99 edges` — against a `.next/cache/fetch-cache`
holding **346** persisted entries. Deleting `.next/cache/fetch-cache` and
restarting made both endpoints correct on the first cold request.

**Affected code:** `app/api/stats/route.ts:7-11` and `app/api/graph/route.ts:11-15`
are the only two `unstable_cache` call sites (`grep -rn "unstable_cache" app lib`).
The pages that render the same data do **not** wrap their queries, which is
exactly why page and API can disagree.

**Detection is now in place:** `scripts/smoke.ts` asserts page↔API agreement, and
a disagreement is a hard failure. Negative control, with the poison restored:

```
✗ /graph page and /api/graph agree on node count — page renders 76 nodes, API returns 0
✗ /api/graph is not an empty payload — API returned 0 nodes against a seeded database
✗ /dashboard page and /api/stats agree — could not compare — page stat 15, api total_hypotheses null
6 FAILURE(S) — 62 passed, 6 failed
```

**Mitigation status — PARTIALLY RESOLVED, and that is the only status this
finding has.** Everything above this line concerns the two `unstable_cache` API
routes. On those, M1/M2 are implemented and hold (`71d50c7`), and the Vercel
exposure analysis behind them is §8. On the ISR pages — same cache, different
path — **nothing is implemented**. Scope and the observed instance: **F-09b**,
immediately below.

*(Superseded text: this paragraph replaced a standing "Not yet mitigated" line
that predated M1/M2 and was never revised. Read together with the RESOLVED
header this section carried until 2026-08-11, the finding asserted two
contradictory statuses at once. It now has one, stated in three places: the
finding header, F-09b, and §8.5.)*

---

### F-09b — the same cache, reached by a path M1/M2 do not cover

**Status: ACCEPTED WITH REASONING — 2026-08-27.** Observed 2026-08-11. No
mitigation is implemented, and after evaluating the alternative none is planned:
the guard that was proposed cannot do the thing it is named for, and the change
that *would* close the class is a caching-architecture decision rather than a
mitigation, deferred on its own terms below. What has changed is detection —
`.github/workflows/production-smoke.yml` runs the smoke against production every
30 minutes. Residual risk is stated at the end of this section.

**What happened.** Immediately after the agent roster was seeded, a *credentialed*
local `next build` prerendered `/agents` with its empty state — "No agents yet" —
while `/agents/[name]` rendered full live data **in the same build**. Deleting
`.next/cache` and rebuilding produced a correct index (125/125 pages). It was
caught by the `/agents` assertion tightened from structural to real data in
`161d878`; the structural-only check it replaced could not have seen it, because
the page's chrome renders identically against an empty database.

**Mechanism.** Supabase reads on ISR pages are ordinary `fetch` calls made by
`@supabase/supabase-js`, and Next persists their responses in the same
`.next/cache/fetch-cache` directory that F-09 is about. The segment's
`revalidate` is inherited by the fetch, and **the full request URL is the key**.
Verbatim from the cache after a clean credentialed rebuild:

```
url        : https://<project>.supabase.co/rest/v1/agent_public?select=*&order=kind.asc%2Cname.asc
revalidate : 3600
tags       : []
```

Two consequences follow from that key:

1. **Same table, different query shape, independent freshness.** `?select=*&order=…`,
   `?select=name`, and `?select=*&name=eq.skeptic` are three separate entries.
   That is precisely how the index served an empty roster while the profile
   pages and `generateStaticParams` served a populated one, in one build.
2. **These entries carry no tags**, so `revalidateTag("graph")` /
   `revalidateTag("stats")` (`lib/revalidation.ts:41-42`) cannot reach them.

**The split, counted.** One clean credentialed build, 212 entries in
`.next/cache/fetch-cache`:

| entries | shape | written by | covered by M1/M2 |
|---|---|---|---|
| 2 | `url: ""`, `tags: ["stats"]` / `["graph"]` | `unstable_cache` | yes |
| 210 | real Supabase REST URL, `tags: []` | automatic fetch cache, ISR pages | **no** |

Their `revalidate` values are 208×`3600` and 2×`900` — the segment values and
nothing else, which is what identifies the segment as the source of the caching.

**This is not the F-09 failure mode, and the distinction decides the remedy.**
F-09 is a *credential* fault: an empty fallback computed with no credentials and
stored under the key a healthy run would use — a value that was **false when it
was written**. F-09b is not that. The `/agents` entry was written by a
*credentialed* read of a table that was genuinely empty at that moment, before
the roster was seeded. It was **true when it was written**, and it became wrong
only because reality moved and the cached copy did not. This is a staleness
fault wearing an emptiness costume.

M2's principle is "refuse to store a value we can prove is false". Here there
was nothing false to prove at write time, so that principle does not extend to
this path — it has no purchase on it. Any remedy that works by inspecting the
payload is reading the one signal that carries no information: an empty body is
identical whether the table is empty or the entry is old.

**Why M1's condition cannot apply.** M1 is "if `HAS_LIVE_SUPABASE` is false,
bypass the cache". On this path that condition never produces a cacheable value
in the first place: with no credentials `SUPABASE_URL` is the placeholder host
(`lib/supabase/env.ts:5-6`), the fetch fails at DNS, and a failed fetch writes
nothing. F-09's own evidence already records this — a credential-free build wrote
**0** entries. The ISR exposure is therefore a *different failure mode* from the
one M1 was written for: not an empty fallback computed without credentials, but
a genuine **HTTP 200 with an empty body** cached as the legitimate result it
syntactically is.

**Why M2's condition cannot apply.** M2 throws `EmptyPayloadError` from inside
the `unstable_cache` callback so the empty value is never stored. The automatic
fetch cache has no callback. Next writes the response into the cache inside the
patched `fetch`, **before any application code sees the body**; by the time
`listPublicAgents` can count the rows and judge them empty, the entry exists.
There is no key to vary, no callback to throw from, and no supported
"do not store this response" signal available at the query layer. M2 is
architecturally out of reach here, not merely unimplemented.

**Scope — every call site that does a Supabase read *and* declares `revalidate`.**
These are the pages that can cache an empty payload by this mechanism:

| call site | revalidate | prerendered |
|---|---|---|
| `app/(public)/page.tsx:13` | 3600 | yes |
| `app/(public)/dashboard/page.tsx:15` | 900 | yes |
| `app/(public)/domains/page.tsx:8` | 3600 | yes |
| `app/(public)/domains/[slug]/page.tsx:19` | 3600 | yes (SSG) |
| `app/(public)/questions/page.tsx:10` | 3600 | yes |
| `app/(public)/questions/[slug]/page.tsx:16` | 3600 | yes (SSG) |
| `app/(public)/evidence/[slug]/page.tsx:19` | 3600 | yes (SSG) |
| `app/(public)/hypotheses/[slug]/page.tsx:21` | 3600 | yes (SSG) |
| `app/(public)/notes/page.tsx:9` | 3600 | yes |
| `app/(public)/notes/[slug]/page.tsx:9` | 3600 | yes (SSG) |
| `app/(public)/lab/page.tsx:9` | 3600 | yes |
| `app/(public)/lab/[category]/page.tsx:18` | 3600 | yes (SSG) |
| `app/(public)/agents/page.tsx:10` | 3600 | yes — **the observed instance** |
| `app/(public)/agents/[name]/page.tsx:16` | 3600 | yes (SSG) |
| `app/(public)/graph/page.tsx:7` | 3600 | **no — renders dynamically** |
| `app/sitemap.ts:12` | 3600 | yes |

`/graph` is the one worth reading twice: it declares `revalidate = 3600` but is
**not** prerendered, so it renders per request while its Supabase reads are still
served from an hour-old cache entry. Being dynamic is not protection.

Out of scope by the same measurement: `/evidence`, `/hypotheses`, `/search`, and
`/timeline` read Supabase but declare no `revalidate`, and no cache entry carries
a `revalidate` value other than the two segment values above.

**What this record does NOT claim.**

- **No mitigation is implemented for the ISR path, and as of 2026-08-27 none is
  planned.** M1/M2 are unchanged and still cover exactly the two API routes. The
  guard proposed for this path was evaluated and declined — see "Option A"
  below for why, and for what was chosen instead.
- **The precise trigger of the observed staleness is not reconstructable.**
  `.next/cache` was deleted to confirm the diagnosis before the offending entry's
  age was captured. The mechanism and the key shape are proven; why that
  particular entry was still being served an hour-plus after it was written is
  not, and is not asserted here.
- **Whether `revalidatePath()` (`lib/revalidation.ts:36-38`) evicts these
  untagged entries was not tested.** Only `revalidateTag` is demonstrably unable
  to reach them. Note also that no `EntityKind` covers agents, so no write path
  revalidates `/agents` at all.
- **Production is currently correct** — post-deploy `/agents` renders all eight
  agents — but that is evidence the vector is not firing there right now, not
  evidence that it is closed.

**Option A — a query-layer guard — considered and DECLINED (2026-08-27).**

The proposal: refuse to return an empty result on a live connection, so an empty
payload never becomes a cached page — M2's principle extended to the automatic
fetch path. Declined for three reasons, in descending order of how fatal they
are.

1. **It cannot stop the write.** Next persists the response inside its patched
   `fetch`, before `@supabase/supabase-js` resolves the body, so by the time
   `listPublicAgents` (`lib/queries/agents.ts:20`) can count rows the entry
   already exists. A throw at the query layer prevents a bad *page*; it does not
   prevent a bad *entry*. The entry then survives for its full `revalidate`, and
   every regeneration inside that window re-reads it and throws again. The guard
   would be named for something it does not do.
2. **It cannot distinguish true-empty from stale.** Both are HTTP 200 with `[]`.
   There is no marker in the response and none available at the query layer. The
   only way to disambiguate is a second, *uncached* read — which requires the
   no-store client described below, at which point the guard is redundant with
   the thing that actually fixes it, having paid double reads on every empty
   result to reach the same answer.
3. **It breaks pre-seed builds, on all fourteen ISR call sites.** With
   credentials present and an unseeded database, every site in the scope table
   above throws during prerender and `next build` fails — an unseeded instance
   could not be deployed at all. M2 escaped exactly this by catching
   `EmptyPayloadError` and answering from an uncached read (§8.3), and that
   escape hatch does not exist here. Note the recursion: the situation that
   *created* F-09b — a build against a database that was empty and then got
   seeded — is precisely the situation in which the guard breaks a legitimate
   build.

**The one variant that would close the class is not a guard, and is deferred.**
Passing `cache: "no-store"` to the Supabase client's `fetch`
(`lib/supabase/public.ts:10` already accepts a `global.fetch`) sits *above*
Next's patched fetch and is the only point with real leverage. It works by
removing the stacking of two caches with independent keys and lifetimes, which is
the entire mechanism: the observed symptom — an empty index and populated
`[name]` pages in one build — is only expressible because
`?select=*&order=…` and `?select=*&name=eq.x` are separate entries that can
differ in age. With page-level ISR alone, one build is one snapshot, and no
payload ever has to be judged.

That is a **caching-architecture change, not a mitigation**: it makes every
prerender and every regeneration a live read. It is deferred as its own decision
rather than folded into F-09b, and it is gated on an unverified premise — see the
open measurements below.

**Correction — CI does not shorten detection for this class (2026-08-27).**

When `.github/workflows/ci.yml` shipped it was asserted that smoke running
automatically on every push meant a recurrence could not stay hidden for long.
That is **false for F-09b**, and saying so plainly is worth more than leaving the
claim tidy. Tier 2 builds inside the runner from a fresh checkout, and nothing
restores `.next/cache` — `actions/setup-node`'s `cache: npm` covers `~/.npm`
only. So the runner's fetch cache is **empty at the start of every run** and is
repopulated from the live database seconds before smoke reads it. A cold fetch
cache cannot reproduce warm-fetch-cache staleness: the runner never holds the
state that *is* the bug. CI models the application; it does not model the cache.

What CI does buy, not inflated into more than it is: a *code* regression that
empties a payload is caught in about three minutes, and the assertions are
exercised on every push so they cannot quietly rot. Neither of those is F-09b.

The environment that carries `.next/cache` across builds is production, so the
detector has to run there, on a clock. That is
`.github/workflows/production-smoke.yml` — every 30 minutes against the deployed
origin, public variables only, a missing variable a hard failure. Thirty minutes
is half the 3600s revalidate, so any exposure window of that length contains at
least two sample points and worst-case detection latency is 30 minutes. Before
this, detection latency was "whenever a human remembers to run it", which is
what actually caught the 2026-08-11 instance and is not a control.

**Open measurements — both UNVERIFIED, with what would settle each.**

- **Does `revalidatePath()` evict untagged fetch entries?** `revalidateTag`
  demonstrably cannot reach them (`tags: []`), while `lib/revalidation.ts:36-38`
  already calls `revalidatePath` for ISR pages on every admin write — so the
  lever may already exist and merely be unproven. **What would settle it:**
  create a genuinely stale entry — read a table through an ISR page, mutate that
  table out of band so the cached body is known-wrong, call `revalidatePath` for
  the route, and re-request inside the original revalidate window. A changed body
  on the first request proves eviction; an unchanged one proves the lever does
  not reach these entries. This inherits §8.4's standing objection that proving
  eviction requires poison that genuinely exists — cheap to satisfy on a local
  tree, which is where it should be done.
- **Does `cache: "no-store"` keep a `revalidate` segment prerendered?** The
  no-store variant is worth much less if opting a fetch out of the data cache
  also forces its segment dynamic, because it would then trade an hour of
  staleness for a live database read on every visitor request rather than on
  every regeneration. **What would settle it:** set it on `publicClient` in a
  scratch branch, run `next build`, and read the route table — the affected pages
  must still print as static/ISR and the static page count must hold at 125. If
  they go dynamic, the variant is a substantially more expensive proposal than it
  appears, and the deferral above becomes a rejection.

**Residual risk, accepted.** A visitor arriving inside an exposure window sees a
page rendering its empty state — "No agents yet" — under HTTP 200, with correct
chrome, correct navigation, and no error anywhere. That is the two-month-outage
shape at smaller scale, which is why this is *accepted with reasoning* rather
than dismissed as minor. The expected bound is the segment's 3600s, but that is
an expectation, not a proof: the observed entry was still being served an
hour-plus after it was written, and the trigger was never reconstructed.
Recovery stays the weakest part — `revalidateTag` cannot reach these entries at
all, and every candidate lever for the other 210 is unverified (§8.4). What is
now true that was not before: the window is sampled every 30 minutes instead of
never.

---

### F-01 — HIGH — Four high-severity advisories in production dependencies

`next`, `postcss`, `sharp`, and `nanoid` all carry high-severity advisories. The
`next` entry includes eight distinct CVEs, several of which apply to the App
Router and to Server Actions, both of which this app uses. This code is
deployed publicly.

**Evidence:** `npm audit`, verbatim:

```
nanoid  <=3.3.16
Severity: high
nanoid: non-secure generators can loop indefinitely with negative size - GHSA-28wg-ghj8-5hjv

next  9.3.4-canary.0 - 16.3.0-preview.10
Severity: high
Next.js: Denial of Service in App Router using Server Actions - GHSA-m99w-x7hq-7vfj
Next.js: Server-Side Request Forgery in Server Actions on custom servers - GHSA-89xv-2m56-2m9x
Next.js: Cache confusion of response bodies for requests with bodies - GHSA-68g3-v927-f742
Next.js: Cache confusion of response bodies ... invalid UTF-8 byte sequences - GHSA-4633-3j49-mh5q
Next.js: Unbounded Server Action payload in Edge runtime - GHSA-4c39-4ccg-62r3
Next.js: SSRF in rewrites via attacker-controlled destination hostname - GHSA-p9j2-gv94-2wf4
Next.js: Denial of Service in the Image Optimization API using SVGs - GHSA-q8wf-6r8g-63ch
Next.js: Unauthenticated disclosure of internal Server Function endpoints - GHSA-955p-x3mx-jcvp

postcss  <=8.5.22   Severity: high   (4 advisories)
sharp  <0.35.0      Severity: high   (libvips CVE-2026-33327/33328/35590/35591)

4 high severity vulnerabilities
```

Installed version is `next@15.5.19` (`npm run build` banner: `▲ Next.js 15.5.19`),
which falls inside the affected range. Whether any advisory is *exploitable* in
this deployment's configuration is **UNVERIFIED** — I did not attempt
exploitation.

---

### F-02 — MEDIUM (was HIGH) — Nothing runs automatically, and there are no unit tests

**Re-rated 2026-08-11.** The original title — "no automated tests, no CI, and no
linting" — is two-thirds stale. Linting now exists and is load-bearing (F-03),
and the verification harnesses have grown to 151 assertions. What has not
changed, and is the whole of the remaining finding, is that **none of it runs by
itself** and **not one unit test exists**.

Severity moves HIGH → MEDIUM because the original rating assumed an unguarded
codebase. It is no longer unguarded: a regression in a public page, a public
grant, the agent invariants, or a lint error is now caught by something. It does
not drop to LOW because every one of those catches depends on a human choosing
to run it, and the coverage has a shape — integration-wide, unit-zero — that
leaves specific, named code untested by anything at all.

#### What exists today

`npm run lint` exists and **fails the production build** on any error, so it
gates deploys rather than advising (see F-03). Three harnesses run green:

| Harness | Assertions | Credentials | Target |
|---|---|---|---|
| `scripts/smoke.ts` | **86** | public (`NEXT_PUBLIC_*` only) | any URL, incl. production |
| `scripts/verify-agents.mjs` | **40** | `SUPABASE_SERVICE_ROLE_KEY` + `SUPABASE_ACCESS_TOKEN` | server on `:3210` |
| `scripts/verify-suggestions.mjs` | **25** | `SUPABASE_SERVICE_ROLE_KEY` | server on `:3210` |

**151 assertions**, all verified green on 2026-08-11 (smoke against both
localhost and production).

A **fourth** harness, `scripts/verify-admin.mjs`, also exists (~20 `check()`
sites; runtime count not measured). It is excluded from the 151 deliberately and
the reason matters for the CI question below: its final step runs
`POST /api/contradictions/scan` against real data and **inserts rows into the
live database**. It is a hand-run pre-deploy tool, not something to fire
casually — which is exactly why its count was not measured for this report.

Alongside these: `validate-sql.mjs` (10 files), `contrast.mjs`, and the
diagnostic `audit-pages.mjs` / `diagnose-rls.mjs`.

#### What none of it covers: there are still zero unit tests

Confirmed 2026-08-11 — no test framework in `dependencies` or `devDependencies`
(no jest, vitest, mocha, playwright, cypress, testing-library), no `*.test.*` or
`*.spec.*` file anywhere outside `node_modules`, and no `test` script.

Everything is tested through HTTP against a live database or not at all. So:

- **Every React component** — zero coverage of any kind. No render test, no
  props test, no interaction test. The graph canvas, the forms, the markdown
  editor: exercised only insofar as a page renders without throwing.
- **Every query-layer function** — exercised indirectly through the pages and
  API routes that call them, never directly. Branches that a public page does
  not reach (admin filters, error paths, the `HAS_LIVE_SUPABASE === false`
  fallback path) are untested.
- **`lib/validations` Zod schemas** — *partially* covered indirectly, and it is
  worth being precise rather than alarmist: the harnesses do assert real
  rejections (`empty rationale → 422`, `hypothesis with no assumptions → 422`,
  `research proposal without a critique → 422`, `out-of-band confidence
  rejected`, `reject: requires a reason (422 without notes)`). What is missing
  is direct coverage — boundary values, optional-field combinations, and every
  schema no harness happens to POST through.
- **`lib/citations.ts`** — likewise partial, not absent. Four integration
  assertions exist (`a real DOI resolves to verified`, `a fabricated reference
  is unresolved, not rejected`, plus route and readability checks). What has no
  coverage is the internals those assertions pass *through*: DOI extraction
  against malformed input, the token-overlap title score, and the threshold
  boundaries that decide `verified` vs `unresolved`. A scoring change that broke
  edge cases while leaving the two happy paths intact would ship green.
- **`sanitizeHeadline` — RESOLVED 2026-08-11.** It now has direct unit coverage:
  `npm run test:unit` (`scripts/test-sanitize.mjs`), **25 assertions**, plain
  node, no framework, in the style of `smoke.ts`. It is the first unit test in
  the repository, so the gate is now six commands rather than five. Eight
  injection vectors are asserted inert against a whitelist invariant (strip
  `<b>`/`</b>` and no angle bracket may survive); the deliberate carve-out is
  pinned; and the `&` escape is asserted separately because removing it promotes
  literal text into real markup — verified by deleting it and watching those
  assertions fail. Writing the tests also surfaced **F-10** (unbalanced output),
  accepted with reasoning. To make it testable at all, the function moved to a
  zero-import `lib/sanitize.ts` and is re-exported from `lib/utils.ts`; both
  call sites are unchanged. The paragraph below describes the state *before*
  that work and is retained for the record.

- **`lib/utils.ts`, and `sanitizeHeadline` in particular — zero coverage, and
  this was the sharpest instance (now resolved, above).** It is the XSS guard: it escapes a Postgres
  `ts_headline()` snippet, then deliberately re-enables `<b>`/`</b>` so the
  search highlight survives (`lib/utils.ts:82-92`). That is security-relevant
  string handling with a deliberate carve-out, rendered through
  `dangerouslySetInnerHTML`. **No assertion anywhere touches it** — `smoke.ts`
  requests `/search?q=consciousness` but asserts only that rows come back, never
  that anything is escaped. A regression that let a `<script>` through would
  pass all 151 assertions. `formatDate`, `slugify`, `truncate`, and
  `stripMarkdown` are equally uncovered, with lower stakes.

#### The real gap: nothing runs any of it automatically

There is still no `.github/workflows` directory and no CI of any kind. Every
gate is a command a human must remember to type, so the guarantee is not "this
repository is verified" but "this repository is verifiable by someone who
remembers all six commands and has the credentials for four of them".

And that credential split is the reason CI is not a five-minute job: `smoke`
runs on public credentials and could gate a PR today, but `verify-agents` and
`verify-suggestions` need `SUPABASE_SERVICE_ROLE_KEY`, which CI would have to
hold. See **§10** for what that would actually cost.

---

### F-03 — MEDIUM — No ESLint configuration exists, so the build lints nothing

`npm run lint` is missing (F-01 table), and there is no ESLint config anywhere.
`next build` prints `Linting and checking validity of types ...` but with no
config present that phase performs type-checking only. The reassuring build line
does not mean lint ran.

**Evidence:**

```
=== ESLint config present? ===
  (no eslint config file at repo root)
  (no eslint in package.json)
```

`README.md:222` already states this as a known limit — "No ESLint or Prettier
config and no lint script; style is not tool-enforced" — so it is documented,
not a surprise. It is listed here because the audit brief asked for `npm run
lint` and that command does not exist.

---

### F-04 — MEDIUM — `NEXT_PUBLIC_SITE_URL` fails silently, emitting `localhost` into production SEO surfaces

`SITE_URL` falls back to `http://localhost:3000` with no guard. It feeds
`sitemap.xml`, `robots.txt`, `metadataBase`, and per-hypothesis OpenGraph URLs.
If the variable is absent in a production build, every one of those emits
localhost URLs and the build still succeeds.

This is the same failure shape the repository's own `DECISIONS.md` documents as a
recurring class (a wrong value producing a plausible-looking success). The
production guard added in `lib/supabase/env.ts` checks `HAS_LIVE_SUPABASE` only;
it does not check `NEXT_PUBLIC_SITE_URL`.

**Evidence:**

`lib/utils.ts:71-72`
```ts
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
```

Consumers:
```
app/layout.tsx:31:      metadataBase: new URL(SITE_URL),
app/robots.ts:14:    sitemap: `${SITE_URL}/sitemap.xml`,
app/robots.ts:15:    host: SITE_URL,
app/sitemap.ts:43:      url: `${SITE_URL}${path}`,
app/(public)/hypotheses/[slug]/page.tsx:46:      url: `${SITE_URL}/hypotheses/${slug}`,
```

The production guard, which does not cover it — `lib/supabase/env.ts:30-35`:
```ts
const IS_PRODUCTION =
  process.env.VERCEL_ENV === "production" ||
  (!process.env.VERCEL &&
    process.env.NODE_ENV === "production" &&
    process.env.NEXT_PHASE !== "phase-production-build");
```

~~Whether `NEXT_PUBLIC_SITE_URL` is actually set in the Vercel production
environment is **UNVERIFIED** — that cannot be determined from this checkout.~~

**Resolved 2026-08-10 — it IS set correctly in production.** Determined from
outside the checkout: production `/sitemap.xml` and `/robots.txt` emit
`https://veritas-delta-pearl.vercel.app`, not the `localhost:3000` fallback.
This is build-time evidence, not merely runtime — Next 15 inlines
`NEXT_PUBLIC_SITE_URL` into the server bundle as a literal (no
`process.env.NEXT_PUBLIC_SITE_URL` read survives anywhere under `.next/server`),
so ISR regeneration replays the baked value and could not have repaired an empty
one. **The silent-fallback hazard described above is unchanged and still
unguarded** — this confirms the current deploy is configured correctly, not that
a future misconfiguration would be caught. See `DECISIONS.md`, "Correction
(2026-08-10) — the Sensitive flag does not blank the build".

---

### F-05 — MEDIUM — Two comments in `lib/queries/agents.ts` describe graceful degradation that does not occur

Both sites call `logQueryError(...)` and discard its return value, with comments
stating the page degrades rather than failing. Since the Phase 2 change,
`logQueryError` **throws** whenever `HAS_LIVE_SUPABASE` is true. On a live
deployment a stats-query failure therefore propagates to the error boundary and
blanks the whole page — the opposite of what the comment claims.

The behaviour may well be the intended one (fail loudly). The finding is that
the comment asserts the opposite, and a future reader relying on it would be
misled.

**Evidence:**

`lib/queries/agents.ts:29-31`
```ts
    // Stats are supplementary: a roster with no counts is still worth showing,
    // so a stats failure logs and degrades rather than blanking the page.
    if (statsRes.error) logQueryError("listPublicAgents:stats", statsRes.error, null);
```

`lib/queries/agents.ts:63`
```ts
    if (statsError) logQueryError("getPublicAgent:stats", statsError, null);
```

`lib/queries/log.ts:37-42` — the throw that makes those comments false:
```ts
    console.error(`[veritas:query:${where}]${code} ${message}`);
    if (HAS_LIVE_SUPABASE) throw new QueryFailedError(where, `${code} ${message}`.trim());
  }
  return fallback;
}
```

The same discard-the-return pattern appears at `lib/queries/graph.ts:66`, but
there the surrounding comment (`graph.ts:64`, "Surface any partial failure
instead of silently returning a thin graph") matches the throwing behaviour, so
it is not misleading. It does mean the `for` loop cannot iterate past the first
failing result.

---

### F-11 — MEDIUM — `propose_with_critique` is a security-definer RLS bypass reachable by any signed-in user

Found 2026-08-28 while writing the grants for migration 0011. Verified against
the live database with a proof of concept; every artifact created was removed.

**The function.** `supabase/migrations/0008_critiques_citations.sql:72-108`
declares `propose_with_critique(...)` `security definer`. It takes
`p_proposed_by uuid` and `p_agent_name text` **from the caller** and inserts
into `suggestions` with `actor_type = 'agent'`. Its grants
(`0008:110-117`) are:

```sql
revoke execute on function propose_with_critique(...) from public, anon;
grant  execute on function propose_with_critique(...) to service_role;
```

`authenticated` is not revoked, and `0001_core.sql:815` sets a default privilege
granting EXECUTE on functions to `anon, authenticated, service_role`. So
`authenticated` retains EXECUTE. Live catalog (`pg_proc.proacl` joined to
`pg_namespace`, re-read 2026-09-04):

```
fn      propose_with_critique(p_target_type node_type, p_operation suggestion_operation,
                              p_target_id uuid, p_payload jsonb, p_rationale text,
                              p_proposed_by uuid, p_agent_name text, p_critic_name text,
                              p_verdict critique_verdict, p_body text, p_findings jsonb)
secdef  true
owner   postgres
acl     {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
        anon=false   auth=true   svc=true
```

The `revoke ... from public, anon` at `0008:110` is why PUBLIC and `anon` are
absent. `authenticated=X/postgres` is there because nothing ever revoked it and
`0001:815` granted it by default — the entry is an inherited default made
explicit at CREATE time, not a deliberate grant anyone wrote.

**Why the RLS on `suggestions` does not stop it.** The insert policy requires a
proposer to be themselves:

```
contributor insert own   INSERT   check=((proposed_by = auth.uid()) AND (status = 'pending'...))
```

A `security definer` function runs as its owner (`postgres`), so that policy is
not evaluated for the insert it performs. The function is the bypass.

**Proof of concept, live.** A brand-new user at the *default* role — not a
researcher, not an admin, not an agent — with a real agent's `profile_id`:

```
attacker profiles.role = 'public'

── direct INSERT into suggestions, WITH a valid in-scope domain_id ──
  REFUSED (42501) new row violates row-level security policy for table "suggestions"

── same payload via the RPC ──
  ALLOWED id=cdfcff05-… agent_name=physics-researcher status=pending
```

The direct path is refused by RLS; the function accepts it. `agent_name` on the
forged row is `physics-researcher` — the caller passed `"x"`, and
`enforce_agent_quota` re-stamped it from the registry, so the forgery is
*better* attributed than the attacker asked for. A `suggestion_critiques` row is
written alongside it in the same transaction.

**What it can and cannot do.**

- **Cannot** change the public map. The row is `pending`; `apply_suggestion()`
  keeps its `is_admin()` self-guard, so approval is still a human decision.
- **Cannot** exceed the victim agent's caps — `enforce_agent_quota` fires
  normally, including the domain-scope check.
- **Can** put agent-attributed content in front of an admin reviewer. Provenance
  is one of the things a reviewer weighs, and here it is forgeable.
- **Can** exhaust a chosen agent's quota: `max_pending` (20) and `max_per_hour`
  (30) are per-agent, so ~20 forged rows make that agent's own proposals fail
  with `53400` until an admin clears the queue. That is a targeted denial of
  service against one agent, requiring no privilege beyond a free account.

**The one real barrier is obscurity, not authorization.** The attack needs the
agent's `profile_id`, which is deliberately absent from every public surface —
`agent_public` projects `name, display_name, kind, charter, status, domain_slug,
domain_name, created_at` and nothing else, and `verify-agents.mjs` asserts that
(*"agent_public leaks no trust / scopes / profile_id"*). Confirmed live during
this test. But a uuid that must stay secret for an authorization boundary to
hold is not an authorization boundary. It leaks through any future view, API
route, admin screenshot, or error message that includes it.

**Severity — MEDIUM, and why not either neighbour.** Not HIGH: nothing reaches
the published map, and the map is what this project's guarantees are about. Not
LOW: it is a genuine RLS bypass, it is reachable by anyone who can sign up, and
the quota-exhaustion path disables a real agent without touching a knowledge
table.

**Fix.** One line — `revoke execute on function propose_with_critique(...) from
authenticated;` — but it is a symptom of the class in §11, so it is proposed in
**§11.7** as step 2 of one migration rather than patched alone. §11.8 records
that the only legitimate caller reaches it as `service_role`
(`app/api/agent/suggestions/route.ts:89` via `requireAgent`), so the revoke costs
the application nothing.

---

### F-06 — LOW — `VERITAS_CROSSREF_MAILTO` is read by code but absent from `.env.example`

Introduced in Phase D stage 2. Missing it is harmless (it only forfeits
Crossref's polite pool), but it is the one env var in the codebase that is not
documented in `.env.example`.

**Evidence:**

`lib/citations.ts:17`
```ts
const MAILTO = process.env.VERITAS_CROSSREF_MAILTO ?? "";
```

`.env.example` documents `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`NEXT_PUBLIC_SITE_URL`, `VERITAS_LLM_*`, `AGENT_MAX_*`, `VERITAS_AGENT_TOKEN` —
and no `VERITAS_CROSSREF_MAILTO`.

---

### F-07 — LOW — `ALTER DEFAULT PRIVILEGES` grants `anon` SELECT on every future table

Every table created after 0001 inherits `SELECT` for `anon` automatically. Four
subsequent migrations each had to remember an explicit `REVOKE` to stay private.
No table currently violates this — all four remembered — but the default is open,
so the next table added is public-readable unless someone remembers.

**Evidence:**

`supabase/migrations/0001_core.sql:806-807`
```sql
alter default privileges in schema public
  grant select on tables to anon;
```

The four compensating revokes:
```
0003_suggestions.sql:252:revoke all on suggestions from anon;
0006_agents.sql:224:revoke all on agents       from anon;
0006_agents.sql:225:revoke all on agent_tokens from anon;
0007_agent_roster.sql:273:revoke all on agent_incidents from anon;
0008_critiques_citations.sql:158:revoke all on suggestion_critiques from anon;
```

Current state: no violation. Classification is *hazard*, not *defect*.

**Status: RESOLVED (2026-08-11) — migration 0009.** The default is inverted:
`alter default privileges for role postgres in schema public revoke all on
tables from anon`. Verified behaviourally, not just in the catalog — a table
created as `postgres` after 0009 gives `anon` `false` on SELECT, INSERT, UPDATE,
DELETE, TRUNCATE, REFERENCES and TRIGGER, with `authenticated` SELECT `true` as
a control. Full record, including the `supabase_admin` default that cannot be
altered from `postgres`, in §9 and DECISIONS.md.

#### F-07a — the `rDxtm` bits are Supabase platform-authored, ACCEPTED not fixed

`anon` does not merely hold SELECT on the 19 readable relations. The live ACL is
`rDxtm` — SELECT, **TRUNCATE**, REFERENCES, TRIGGER, MAINTAIN. RLS does not
restrain TRUNCATE. This was investigated before scoping a fix, because the
provenance decides whether a fix is possible at all.

**These bits were not produced by this repository's migrations.** Three
independent lines of evidence, all from live state:

1. **`grant select` yields `r` alone — measured, not assumed.** A table created
   as `postgres` (which post-0009 inherits nothing for `anon`), then granted
   select:
   ```
   f07_bits_probe | {postgres=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,
                     service_role=arwdDxtm/postgres,anon=r/postgres}   anon_bits = r
   ```
   Probe dropped afterwards. Every anon grant we author is `grant select`; the
   10 `grant all` statements across all migrations target **`service_role` every
   time, never `anon`**, and no grant of TRUNCATE/REFERENCES/TRIGGER/MAINTAIN to
   `anon` exists anywhere. Nor is there any revoke of INSERT/UPDATE/DELETE from
   `anon`, so the absent `a`,`w`,`d` were never granted rather than
   granted-then-removed.
2. **A schema we have never written to carries the identical signature.** The
   `postgres`-owned default ACL for `storage` tables is
   `{… anon=arwdDxtm/postgres …}`. No migration in this repository touches
   `storage`. The decisive case is the `supabase_admin`-owned entry for `public`
   (`anon=arwdDxtm`): it **cannot** have come from our migrations, because
   `postgres` is not a member of `supabase_admin` and therefore cannot execute
   the statement that creates it. The platform demonstrably authors
   default-ACL entries granting `anon` broad rights.
3. **Creation date is irrelevant to the bits.** `citation_checks` was created in
   **0008**, seven migrations after `domains` (**0001**), and its only anon
   statement is `grant select … to anon` — which line 1 proves yields `r`. Both
   carry the identical `rDxtm`. All 19 anon-readable relations are uniform
   regardless of which migration created them. The extra bits arrive at
   `CREATE TABLE` from the default ACL, not from any statement we wrote.

Our own block confirms it by subtraction — `0001_core.sql:805-811` grants
defaults of `select` to `anon`, `select, insert, update, delete` to
`authenticated`, and `all` to `service_role`. Yet `Dxtm` appears on **both**
`anon` and `authenticated`, two roles we granted it to neither. `0001:790-792`
even says so: *"Supabase normally sets these via default privileges."*

**`authenticated` carries the same bits on every relation — `arwdDxtm`, all 24 —
and is the more privileged role.** It is held by real logged-in contributors,
not anonymous visitors, so if these bits were reachable it would be the larger
exposure of the two, not a footnote to the anon case.

**Why this is closed as accepted rather than fixed:**

- **Not exploitable.** PostgREST exposes no TRUNCATE verb, so there is no route
  from an anon or authenticated API key to that privilege. Latent over-grant,
  not a live hole.
- **Not caused by us.** See the three evidence lines above.
- **Not closable by us while the `supabase_admin` default stands.** That entry
  still grants `anon` `arwdDxtm` on anything that role creates in `public`, and
  `postgres` cannot alter it (`pg_has_role(...)` → false, `rolsuper` → false).
  A revoke pass would clean today's relations without closing tomorrow's door.
- **The fix costs more than the risk it removes.** Revoking would mean altering
  grants on existing tables — the exact operation that produced the 0002 outage
  (RLS enabled, grants misaligned, every row denied to `anon`, pages served
  empty under HTTP 200 for weeks). Paying that risk for **no reachable**
  reduction in exposure is a bad trade.

**What is watched instead.** `scripts/smoke.ts` asserts that the
`postgres`-owned default ACL for `public` tables contains no `anon=` entry, so a
platform re-application of its baseline cannot silently undo 0009. See §9.

---

### F-08 — LOW (environment, not code) — Eight orphaned `next` processes were holding file locks

`npm ci` could not run until these were terminated. They are leftovers from
background dev/preview servers started during earlier sessions in this
repository; stopping the task wrappers did not stop the child processes.

**Evidence:** `Get-CimInstance Win32_Process -Filter "Name='node.exe'"`, filtered
to Veritas:

```
41180: "node" "D:\Veritas\node_modules\.bin\..\next\dist\bin\next" dev -p 3111
27564: node.exe D:\Veritas\node_modules\next\dist\server\lib\start-server.js
34052: "node" ...\next start -p 3113
28972: "node" ...\next start -p 3115
40824: "node" ...\next start -p 3116
 7760: "node" ...\next start -p 3117
50172: "node" ...\next dev -p 3210
37576: node.exe D:\Veritas\node_modules\next\dist\server\lib\start-server.js
--- remaining Veritas node procs: 0
```

No repository file was changed by this cleanup.

---

### F-10 — LOW — `sanitizeHeadline` can emit unbalanced `<b>` markup — ACCEPTED, not fixed

Found 2026-08-11 by the new unit coverage (F-02), not by inspection. A literal
`<b>` or `</b>` in the **source text** produces unbalanced output, because the
re-enable step cannot distinguish ts_headline's own markers from a bold tag the
author typed:

```
"<b>unclosed bold"  ->  "<b>unclosed bold"     (opens=1 closes=0)
"<b</b>"            ->  "&lt;b</b>"            (opens=0 closes=1)
"</b>orphan closer" ->  "</b>orphan closer"    (opens=0 closes=1)
```

**Not a security issue, and the same test run proves it.** The output still
satisfies the invariant that nothing but `<b>`/`</b>` survives as raw markup —
`<b>` carries no attributes and no script capability, and all eight injection
vectors in section 1 of `scripts/test-sanitize.mjs` remain inert. The
consequence is cosmetic: injected into a `<span>` via `dangerouslySetInnerHTML`,
the HTML fragment parser closes an unclosed `<b>` at the container boundary and
discards an orphan `</b>`, so at worst the remainder of one search-result line
renders bold. (Parser behaviour reasoned from the spec, not measured in a
browser — stated as such.)

**Accepted rather than fixed, for three reasons:**

1. **Barely reachable.** `ts_headline()` always emits balanced tags itself, so
   this requires the underlying admin-authored markdown to contain a literal
   bold tag.
2. **No security gain.** Balancing would not close any vector; section 1 already
   passes on every malformed input tested.
3. **The cost lands in the wrong place.** It would add tag-counting logic to the
   one security-critical function in the codebase, to fix a cosmetic defect.
   Complexity added to a sanitiser is paid for in review burden forever.

**Locked in rather than left to drift:** the three cases above are asserted in
`scripts/test-sanitize.mjs` section 6, explicitly labelled *characterization —
current behaviour, NOT desired behaviour*. If someone later balances the output
those assertions fail by design, which is the prompt to update them and this
finding together.

---

## 3. Route inventory

45 `page.tsx` and 30 `route.ts` files. Render mode is taken from the `npm run
build` output (`○` static, `●` SSG with `generateStaticParams`, `ƒ` dynamic);
data source is taken from `@/lib/queries/*` imports in each file.

### Public pages

| Path | Render | Directive | Reads |
|---|---|---|---|
| `/` | ○ static | `revalidate = 3600` | domains, hypotheses, questions, stats |
| `/agents` | ○ static | `revalidate = 3600` | agents |
| `/agents/[name]` | ● SSG | `revalidate = 3600` | agents |
| `/dashboard` | ○ static | `revalidate = 900` | stats, contradictions, timeline |
| `/domains` | ○ static | `revalidate = 3600` | domains |
| `/domains/[slug]` | ● SSG | `revalidate = 3600` | domains, hypotheses, questions, evidence |
| `/evidence` | ƒ dynamic | `force-dynamic` | evidence |
| `/evidence/[slug]` | ● SSG | `revalidate = 3600` | evidence, citations |
| `/graph` | ƒ dynamic | `revalidate = 3600` | graph |
| `/hypotheses` | ƒ dynamic | `force-dynamic` | domains, hypotheses |
| `/hypotheses/[slug]` | ● SSG | `revalidate = 3600` | hypotheses, contradictions |
| `/lab` | ○ static | `revalidate = 3600` | simulations |
| `/lab/[category]` | ● SSG | `revalidate = 3600` | simulations |
| `/notes` | ○ static | `revalidate = 3600` | notes |
| `/notes/[slug]` | ● SSG | `revalidate = 3600` | notes |
| `/questions` | ○ static | `revalidate = 3600` | questions |
| `/questions/[slug]` | ● SSG | `revalidate = 3600` | questions |
| `/search` | ƒ dynamic | `force-dynamic` | search |
| `/timeline` | ƒ dynamic | `force-dynamic` | timeline |

Note: `/graph` declares `revalidate = 3600` yet the build reports it as `ƒ`
(dynamic). Both facts are as observed; the reason is **UNVERIFIED**.

`/login` is the only **client** component among all 45 pages:

```
app/(auth)/login/page.tsx | CLIENT
```

### Admin pages (all `ƒ` dynamic, no revalidate directive)

`/admin` (timeline) · `/admin/contradictions` (contradictions) ·
`/admin/domains` (domains) · `/admin/domains/new` · `/admin/domains/[id]` ·
`/admin/evidence` (evidence) · `/admin/evidence/new` (domains) ·
`/admin/evidence/[id]` (domains) · `/admin/hypotheses` (hypotheses) ·
`/admin/hypotheses/new` (domains) · `/admin/hypotheses/[id]` (domains,
hypotheses, contradictions) · `/admin/notes` (notes) · `/admin/notes/new` ·
`/admin/notes/[id]` · `/admin/questions` (questions) · `/admin/questions/new`
(domains) · `/admin/questions/[id]` (domains) · `/admin/simulations`
(simulations) · `/admin/simulations/new` · `/admin/simulations/[id]`
(simulations) · `/admin/suggestions` (suggestions)

### Contribute pages (all `ƒ` dynamic)

`/contribute` · `/contribute/evidence/new` (domains) ·
`/contribute/hypotheses/new` (domains) · `/contribute/suggestions` (suggestions)

### API routes (all `ƒ` dynamic, server)

`/auth/callback` · `/api/agent/citations` · `/api/agent/suggestions` ·
`/api/contradictions` · `/api/contradictions/[id]` · `/api/contradictions/scan` ·
`/api/domains` · `/api/domains/[id]` · `/api/evidence` · `/api/evidence/[id]` ·
`/api/graph` · `/api/hypotheses` · `/api/hypotheses/[id]` ·
`/api/hypotheses/[id]/confidence` · `/api/hypotheses/[id]/evidence` ·
`/api/notes` · `/api/notes/[id]` · `/api/questions` · `/api/questions/[id]` ·
`/api/revalidate` · `/api/search` · `/api/simulations` · `/api/simulations/[id]` ·
`/api/simulations/[id]/runs` · `/api/stats` · `/api/suggestions` ·
`/api/suggestions/[id]/approve` · `/api/suggestions/[id]/reject` ·
`/api/suggestions/[id]/withdraw` · `/api/timeline`

---

## 4. Query layer — throw vs. fallback

All 33 exported functions across `lib/queries/*.ts` route their error paths
through `logQueryError` / `logQueryThrow`, **except one**. Those two helpers are
conditional:

`lib/queries/log.ts:37-42, 47-56`
```ts
    console.error(`[veritas:query:${where}]${code} ${message}`);
    if (HAS_LIVE_SUPABASE) throw new QueryFailedError(where, `${code} ${message}`.trim());
  }
  return fallback;
}

export function logQueryThrow<T>(where: string, err: unknown, fallback: T): T {
  if (err instanceof QueryFailedError) throw err;
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[veritas:query:${where}] threw: ${message}`);
  if (HAS_LIVE_SUPABASE) throw new QueryFailedError(where, message);
  return fallback;
}
```

So the answer is **conditional, not per-function**:

- `HAS_LIVE_SUPABASE === false` → every function returns its fallback silently
  (logged to console only). This is the entire no-credentials path.
- `HAS_LIVE_SUPABASE === true` → every function throws.

`HAS_LIVE_SUPABASE` is defined at `lib/supabase/env.ts:14-16`:
```ts
export const HAS_LIVE_SUPABASE =
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
  !process.env.NEXT_PUBLIC_SUPABASE_URL?.includes("placeholder");
```

### Remaining silent-fallback paths

**Unconditionally silent — 1 site:**

| file:line | Function | Behaviour |
|---|---|---|
| `lib/queries/hypotheses.ts:152-155` | `incrementPopularity` | bare `catch {}`, swallows everything, always |

```ts
  try {
    await client.rpc("increment_popularity", { h_id: hypothesisId });
  } catch {
    /* a lost view tick is fine */
  }
```

This never touches the log helpers, so it is silent even with live credentials.
It is labelled deliberate at `hypotheses.ts:147` ("Fire-and-forget view counter;
deliberately silent in the timeline").

**Silent only when `HAS_LIVE_SUPABASE` is false — 3 sites** where the helper's
return value is discarded and execution continues with partial data:

| file:line | Discarded call |
|---|---|
| `lib/queries/agents.ts:31` | `logQueryError("listPublicAgents:stats", …)` |
| `lib/queries/agents.ts:63` | `logQueryError("getPublicAgent:stats", …)` |
| `lib/queries/graph.ts:66` | `logQueryError(\`getGraphPayload:${name}\`, …)` |

With live credentials these three throw instead (see F-05).

**Data-fetching outside the query layer that is silent by construction — 1 site:**

`lib/citations.ts:100-107`
```ts
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    // Network failure, timeout, or malformed JSON. Indistinguishable from "not
    // indexed" for our purposes, and both mean `unresolved` — a flag, never a
    // rejection.
    return null;
```

A Crossref/OpenAlex outage is therefore indistinguishable from "citation not
found", and both surface to the reader as `unresolved`.

---

## 5. Migrations — tables, RLS, policies, GRANTs

Read in order: `0001_core` → `0002_fix_rls` → `0003_suggestions` →
`0004_proposer_provenance` → `0005_agent_role` → `0006_agents` →
`0007_agent_roster` → `0008_critiques_citations`.

20 tables are created; **20 have RLS enabled**; **all 20 carry at least one
policy**. `0004` and `0005` create no tables (function replacement and one
`ALTER TYPE` respectively).

`anon` and `authenticated` privileges come from three sources: the blanket grants
at `0001:796-800`, the `ALTER DEFAULT PRIVILEGES` at `0001:806-815` (covering all
later tables), and per-table statements in `0003`/`0006`/`0007`/`0008`.

| Table | Created | RLS | Policies | anon | authenticated |
|---|---|---|---|---|---|
| `profiles` | 0001:41 | ✅ 0001:675 | own profile read / update (both `or is_admin()`) | SELECT (blanket) | SIUD (blanket) |
| `domains` | 0001:88 | ✅ 0001:676 | public read · admin write | SELECT | SIUD |
| `questions` | 0001:99 | ✅ 0001:677 | public read · admin write | SELECT | SIUD |
| `hypotheses` | 0001:114 | ✅ 0001:678 | public read non-draft ×2 · admin all ×2 | SELECT | SIUD |
| `sources` | 0001:146 | ✅ 0001:679 | public read · admin write | SELECT | SIUD |
| `evidence` | 0001:158 | ✅ 0001:680 | public read · admin write | SELECT | SIUD |
| `hypothesis_evidence` | 0001:174 | ✅ 0001:681 | public read · admin write | SELECT | SIUD |
| `graph_edges` | 0001:188 | ✅ 0001:682 | public read · admin write | SELECT | SIUD |
| `contradictions` | 0001:200 | ✅ 0001:683 | public read · admin write | SELECT | SIUD |
| `timeline_events` | 0001:218 | ✅ 0001:684 | **public read only** | SELECT | SIUD grant, no write policy |
| `confidence_history` | 0001:232 | ✅ 0001:685 | **public read only** | SELECT | SIUD grant, no write policy |
| `simulations` | 0001:244 | ✅ 0001:686 | public read · admin write | SELECT | SIUD |
| `simulation_runs` | 0001:259 | ✅ 0001:687 | public read · admin write | SELECT | SIUD |
| `research_notes` | 0001:271 | ✅ 0001:688 | public read published ×2 · admin all ×2 | SELECT | SIUD |
| `suggestions` | 0003:43 | ✅ 0003:77 | contributor insert own · read own or admin · proposer update own pending · admin manage | **REVOKED** 0003:252 | SIUD 0003:250 |
| `agents` | 0006:43 | ✅ 0006:83 | admin manage agents | **REVOKED** 0006:224 | SIUD 0006:220 |
| `agent_tokens` | 0006:66 | ✅ 0006:88 | admin manage agent_tokens | **REVOKED** 0006:225 | SIUD 0006:221 |
| `agent_incidents` | 0007:197 | ✅ 0007:209 | admin read agent_incidents | **REVOKED** 0007:273 | SIUD 0007:271 |
| `suggestion_critiques` | 0008:34 | ✅ 0008:51 | admin manage critiques | **REVOKED** 0008:158 | SIUD 0008:156 |
| `citation_checks` | 0008:127 | ✅ 0008:144 | public read (`using (true)`) · admin write | SELECT 0008:152 | SIUD 0008:153 |

Two views also exist:

| View | Definition | anon |
|---|---|---|
| `graph_nodes` | `0001:656` — `with (security_invoker = on)` | SELECT `0001:820` |
| `dashboard_stats` | matview | SELECT `0001:819` |
| `agent_public` | `0007` — `security_invoker` **not set** (defaults to off) | SELECT `0007:268` |
| `agent_public_stats` | `0007` — `security_invoker` **not set** | SELECT `0007:269` |

```
=== security_invoker anywhere? ===
supabase/migrations/0001_core.sql:656:create view graph_nodes with (security_invoker = on) as
supabase/migrations/0007_agent_roster.sql:219:-- These views are deliberately security_invoker = OFF (the default)
```

### Tables with RLS but no matching GRANT

**None.** Every one of the 20 tables has an explicit privilege position — either
a grant, or a deliberate revoke. The 42501 class of bug that migration `0002`
was written to fix (`0002` header, and `DECISIONS.md` "Post-launch fix — empty
public reads") does not recur anywhere in the current set.

Two related observations, neither a defect:

- `timeline_events` and `confidence_history` grant `authenticated` full
  INSERT/UPDATE/DELETE via the blanket grant at `0001:798`, but carry **no write
  policy**. Writes therefore fail closed under RLS. This is the append-only
  design described in `README.md:47-53`; the trigger functions are
  `SECURITY DEFINER`, which is how their inserts get through.
- `agent_public` / `agent_public_stats` run as owner and so bypass the
  admin-only RLS on `agents` and `suggestions`. The column list is the only
  thing keeping `trust`, `scopes`, and `profile_id` private. Verified live: the
  `verify-agents.mjs` check `public: agent_public leaks no trust / scopes /
  profile_id` passes, and `agent_public` selects only `name, display_name, kind,
  charter, status, domain_slug, domain_name, created_at` (`0007`).

---

## 6. Environment variables

20 distinct variables are referenced. "Loud" means the process stops or the
build fails; "silent" means execution continues with a substituted value.

| Variable | Read at | Missing ⇒ |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `lib/supabase/env.ts:6,15,16` | **Silent** in dev/preview (placeholder host). **Loud** in production — throws at module load, `env.ts:57` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `lib/supabase/env.ts:9` | **Silent always** — falls back to `"placeholder-anon-key"`; the production guard tests only the URL |
| `SUPABASE_SERVICE_ROLE_KEY` | `lib/supabase/env.ts:12` | **Silent** in app code (`"placeholder-service-role-key"`); **loud** in scripts via `requireEnv` |
| `NEXT_PUBLIC_SITE_URL` | `lib/utils.ts:72` | **Silent** — `http://localhost:3000`. See F-04 |
| `VERCEL_ENV`, `VERCEL`, `NODE_ENV`, `NEXT_PHASE` | `lib/supabase/env.ts:31-34` | Absence is meaningful input, not an error |
| `VERITAS_CROSSREF_MAILTO` | `lib/citations.ts:17` | **Silent** — omits the polite-pool contact. Harmless; see F-06 |
| `VERITAS_AGENT_TOKEN` | `run-research-agent.mjs:44`, `run-contradiction-agent.mjs:37` | **Loud** — explicit check and exit at `run-research-agent.mjs:45-46` |
| `VERITAS_LLM_PROVIDER` | `agent-lib/llm.mjs:48` | **Silent** — defaults to `openai-compatible` (local Ollama) |
| `VERITAS_LLM_BASE_URL` | `agent-lib/llm.mjs:57` | **Silent** — per-provider default |
| `VERITAS_LLM_MODEL` | `agent-lib/llm.mjs:55` | **Silent** — per-provider default |
| `VERITAS_LLM_API_KEY` | `agent-lib/llm.mjs:58` | **Silent** for local; **loud** for a cloud provider (documented `DECISIONS.md` B.9-1 as throwing) |
| `VERITAS_LLM_MAX_TOKENS` | `run-research-agent.mjs:169` | **Silent** — `1500` |
| `VERITAS_LLM_TEMPERATURE` | `agent-lib/llm.mjs` | **Silent** — default |
| `AGENT_MAX_MODEL_CALLS` | `agent-lib/caps.mjs:67` | **Silent** — `16` |
| `AGENT_MAX_PROPOSALS` | `agent-lib/caps.mjs:71` | **Silent** — `5` |
| `AGENT_MAX_OUTPUT_TOKENS` | `agent-lib/caps.mjs:75` | **Silent** — `50000` |
| `BASE_URL` | runners + verify scripts | **Silent** — `localhost:3000` / `localhost:3210` |

The loud production guard, `lib/supabase/env.ts:57`:
```ts
if (typeof window === "undefined" && IS_PRODUCTION && !HAS_LIVE_SUPABASE) {
  throw new Error(
```

`requireEnv`, used by the ops scripts — `scripts/agent-lib/env.mjs:22-26`:
```js
export function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}
```

Two verify scripts read `SUPABASE_SERVICE_ROLE_KEY` **without** `requireEnv`
(`verify-agents.mjs:26`, `verify-admin.mjs:25`, `verify-suggestions.mjs:23`) and
pass it straight to `createClient`. That still fails loudly, but with a generic
message:

```
createClient(undefined key) throws: supabaseKey is required.
```

Worth noting: `NEXT_PUBLIC_SUPABASE_ANON_KEY` has no production guard of its own.
A deploy with a correct URL and a missing anon key would set
`HAS_LIVE_SUPABASE = true`, skip the `env.ts` throw, and fail at query time
instead — which, since Phase 2, throws to the error boundary rather than
rendering empty. Loud, but one layer later than the URL case.

---

## 7. Test coverage

**There are no automated tests.** No unit tests, no component tests, no
integration tests, no end-to-end tests, no test runner, and no CI. See F-02 for
the evidence.

What exists instead, and what each actually covers:

| Script | Needs | Covers |
|---|---|---|
| `validate-sql.mjs` | nothing | Parses 9 SQL files against the PostgreSQL grammar. Syntax only — not semantics, privileges, or ordering |
| `contrast.mjs` | nothing | WCAG AA contrast for the palette across two surfaces and both themes |
| `audit-pages.mjs` | live DB | Replays 21 public read probes through the anon client |
| `verify-admin.mjs` | live DB + server | 19 checks over the admin write path |
| `verify-suggestions.mjs` | live DB + server | 25 checks over the human suggestion queue |
| `verify-agents.mjs` | live DB + server | 38 checks over the agent layer |
| `diagnose-rls.mjs` | live DB | Compares `anon` against `service_role` per table |

Four of the seven cannot run without credentials and a running server, so they
cannot gate a pull request as written. The three live `verify-*` scripts are the
only tests of authorization behaviour in the repository, and their results are
**UNVERIFIED in this audit** — I did not re-run them here, as that requires a
dev server against the production database.

Uncovered by anything: all React components, all query-layer functions, every
Zod schema in `lib/validations`, `lib/citations.ts` (DOI extraction, title
scoring, threshold logic), `lib/utils.ts` (including `sanitizeHeadline`, the XSS
guard described at `README.md:62-64`).

---

## 8. F-09 — Vercel exposure, mitigations, and closure

### 8.1 Does the build-time guard abort before a cache entry is written?

**On a Vercel *production* build: yes — but the guard is not what protects it,
and it is not the vector that matters.**

Two independent facts, both verified locally:

**(a) The guard does fire on a production build.** `lib/supabase/env.ts:30-35`:

```ts
const IS_PRODUCTION =
  process.env.VERCEL_ENV === "production" ||
  (!process.env.VERCEL &&
    process.env.NODE_ENV === "production" &&
    process.env.NEXT_PHASE !== "phase-production-build");
```

The first disjunct has no `NEXT_PHASE` exemption, so on a Vercel production
build (`VERCEL_ENV=production`) with the URL missing, `env.ts:57` throws at
module load. Verified: `VERCEL_ENV=production npm run build` with credentials
removed exits **1** during *Collecting page data*, before any page or route is
executed. No deployment is produced, so no cache is populated.

**(b) A build cannot write these entries anyway.** The only two `unstable_cache`
call sites are API route handlers, and API routes are not prerendered. A
credential-free build wrote **0** `fetch-cache` entries (§F-09 step 1). So the
"does the guard beat the cache write" question is moot for builds in both
directions.

**The vector is the runtime, not the build** — specifically a runtime where
`IS_PRODUCTION` is false so the guard deliberately stays silent:

| Environment | `VERCEL_ENV` | Guard fires? | Can write poison? |
|---|---|---|---|
| Vercel production | `production` | **yes** — build fails, nothing deploys | no |
| Vercel preview | `preview` | **no** (by design — previews build without credentials) | **yes**, if a request reaches `/api/stats` or `/api/graph` |
| Local `next start` | unset | yes (`NODE_ENV=production`, no `VERCEL`, no build phase) | no |
| Local, `VERCEL=1 VERCEL_ENV=preview` | `preview` | no | **yes — demonstrated in §F-09** |

### 8.2 Can Vercel's Data Cache be poisoned the same way?

**Answered from Vercel's documentation (2026-08-10), not from a live test.** The
preview→production vector is closed by documented environment isolation; the
production→production vector is **not**, and that is what M1/M2 exist for.

**Established independently of the docs:**
- The mechanism is real and deterministic on the filesystem cache handler used
  by `next start` (§F-09, reproduced end to end).
- A Vercel *preview* deployment runs with `VERCEL_ENV=preview`, which by design
  does not trip the guard, and if it has no Supabase credentials its
  `/api/stats` and `/api/graph` will compute and cache the same empty payloads.
- A Vercel *production* deployment cannot be created without credentials, so it
  cannot poison its own cache with the *no-credentials* fallback.

**Which cache layer applies.** Both pages were checked, because
[Data Cache](https://vercel.com/docs/caching/runtime-cache/data-cache)
(*last updated 2026-07-27*) states it is "for Next.js 14 and below" and directs
Next.js 15+ to
[Runtime Cache](https://vercel.com/docs/caching/runtime-cache)
(*last updated 2026-07-27*) — a real gap, since this project is Next 15.1.6. It
closes cleanly: the Runtime Cache page's own version table maps **Next.js 15 +
`unstable_cache` → Data cache**, so the two call sites land on Data Cache. Both
pages assert environment isolation regardless, so the answer does not depend on
resolving the layer.

**The three questions of §8.2, answered:**

1. **Shared between `preview` and `production`, or partitioned? — Partitioned.**
   Data Cache: *"**Isolated by environment**: Each deployment environment
   (`production` or `preview`) uses its own cache, so they never share cached
   data"*, and *"Every plan splits the cache by deployment environment, so
   `production` and `preview` never share cached data."* Runtime Cache states
   the same in near-identical words. Note "**every plan**" — the Hobby/Pro
   project-sharing distinction in the storage-scope tables does not affect the
   environment axis. **Per this section's own stated logic, preview poison never
   reaches production, and the residual preview risk is limited to previews
   looking broken.**
2. **Does the restored build cache carry `fetch-cache` entries into a later
   deployment's runtime Data Cache? — No.** Data Cache: *"Cache is **not**
   updated at build time."* This agrees with the local finding in §8.1(b) that a
   credential-free build wrote **0** `fetch-cache` entries; the build is not the
   vector in either direction.
3. **Does the cache key incorporate the deployment id? — No.** Data Cache:
   *"**Persistent across deployments**: Cached data persists across deployments
   unless you explicitly invalidate it"*, and *"Vercel persists cached data
   across deployments, unless you explicitly invalidate it using framework APIs
   like `res.revalidate`, `revalidateTag`, and `revalidatePath`, or by manually
   purging the cache."* Runtime Cache adds: *"TTL and tag updates aren't
   reconciled between deployments."*

**Question 3 came back the dangerous way, and it is the reason M1/M2 are
load-bearing rather than defence in depth.** Entries carry no deployment id, so
**a redeploy does not clear poison** — the intuitive "just ship again" recovery
does not work. Combined with the fact that production can poison *itself*, this
is a live production risk that documented isolation does nothing to reduce:

> The no-credentials fallback cannot occur in production (the §8.1 guard makes
> that build impossible), but an **empty-yet-successful** read can. A `null`
> `dashboard_stats` from a matview that was never refreshed, or a genuinely
> empty graph payload, is not a failure — the query layer does not throw, so
> Phase 2's loud-failure hardening never engages — and pre-M2 it was written to
> the cache under exactly the healthy key. That is precisely the original F-09
> discovery: `/api/stats` returning `data is null — dashboard_stats never
> refreshed` on a server whose `/graph` page rendered 76 nodes. It then persists
> for the full revalidate window, survives every redeploy, and is served with
> HTTP 200.

**So the preview verdict must not be read as "F-09 was not a real risk."** It
bounds one vector (preview→production) and leaves the one that actually produced
the observed incident (production→production, via a degraded-but-successful
read) fully intact. M1 stops the credential-free write; **M2 is what stops the
production self-poisoning case**, and without it a single empty read pins itself
into a cache that no redeploy will clear.

**Basis and why we did not verify live.** Every answer above is **Vercel's
documented behaviour, not an observation of this running system.** The live
experiment was designed (`probe/f09-preview-cache`, an empty commit on a
pre-M1/M2 tree, so the preview would actually write poison) and deliberately
**not run**. A *positive* result — preview poison surfacing in production —
would itself have been a production incident: it would have written empty
payloads into the production cache, where M1/M2 prevent new writes but do not
clean existing entries, and where question 3's answer means no redeploy would
remove them. Running a test whose success condition is "production is now
serving empty data" was not a reasonable trade against documentation this
explicit. This is a deliberate, recorded limit on the strength of the evidence,
not an oversight.

**Residual risk statement:** the demonstrated exposure is to any self-hosted or
`next start` deployment, and to Vercel *preview* deployments. Production
exposure via a preview is **closed by documented environment isolation**.
Production exposure via production's own degraded reads was **real, is mitigated
by M1/M2, and is not self-healing on redeploy** — see §8.4 for the recovery
lever.

### 8.3 Mitigations — M1, M2 and M5 shipped

Listed cheapest-first, as originally proposed. **M1, M2 and M5 have since been
implemented** — M1/M2 in commit `71d50c7`, M5 in `scripts/smoke.ts`. M3 and M4
remain proposals held in reserve. The sketches below are preserved as first
written; see the note after the recommendation for what actually shipped.

**M1 — Do not cache a value computed without credentials.** The root cause is
that an empty fallback is cached as though it were a result. Gate the cache
wrapper on `HAS_LIVE_SUPABASE` and bypass it entirely when false:

```ts
// sketch only — not implemented
const stats = HAS_LIVE_SUPABASE
  ? await getCachedStats()
  : await getDashboardStats(publicClient);
```

Cost: one import and a ternary per call site (two sites). Removes the write
without changing behaviour on a healthy deploy. **Recommended as the primary
fix** — it addresses the cause rather than the symptom.

**M2 — Treat an empty payload as a cache miss.** Inside the cached function,
throw rather than return when the result is empty *and* credentials are live, so
`unstable_cache` never stores it:

```ts
// sketch only — not implemented
if (HAS_LIVE_SUPABASE && payload.nodes.length === 0) {
  throw new Error("refusing to cache an empty graph payload");
}
```

This is defence in depth behind M1, and it also catches a genuinely empty
*result* from a live database — which for a seeded map is itself a fault. Note
the trade-off: a legitimately empty database (a fresh install before `seed.sql`)
would then error rather than render empty, so this should be conditional on
`HAS_LIVE_SUPABASE` exactly as written, and never applied to the no-credentials
path.

**M3 — Include a credential fingerprint in the cache key.** Add a short hash of
the resolved Supabase URL to the `unstable_cache` key array, so a placeholder
run and a live run occupy different keys and can never collide:

```ts
// sketch only — not implemented
unstable_cache(fn, ["graph", domain ?? "all", CREDENTIAL_FINGERPRINT], …)
```

Strictly more robust than M1/M2 — it makes the collision impossible rather than
avoided — but it changes cache keys, which invalidates every existing entry on
deploy, and it puts a credential-derived value into a cache key. Worth it only
if M1 proves insufficient.

**M4 — Clear the cache on deploy.** A `.next/cache/fetch-cache` purge in the
build step. Blunt, costs build time (it is also the compile cache), and does not
help a long-running server that is poisoned *after* deploy. Not recommended
except as a one-off remediation for an already-poisoned environment.

**M5 — Detection, already implemented.** `scripts/smoke.ts` now fails when the
page and the API disagree, and when either payload is empty against a seeded
database. This does not prevent the poisoning; it makes it impossible for the
next occurrence to be silent. Verified by negative control (§F-09).

**Recommendation: M1 + M2, with M5 already in place.** M1 stops the write, M2
stops the read from ever being stored behind it, and M5 catches a regression.
M3 and M4 are held in reserve.

**Shipped (commit `71d50c7`).** M1 and M2 were implemented as recommended, in
`app/api/graph/route.ts` and `app/api/stats/route.ts`, with `EmptyPayloadError`
added to `lib/api.ts`. M2 departs from the sketch in one respect worth noting:
throwing is used purely as the signal that tells `unstable_cache` not to persist
a value — the route catches `EmptyPayloadError` and answers from an *uncached*
read, so an empty result is still **served**, only never **stored**. That keeps
a fresh pre-seed database rendering empty rather than erroring, which the sketch
above flagged as the trade-off to avoid. `QueryFailedError` and everything else
propagates and stays loud.

Note the scope limit, stated precisely because the two claims differ: M1 and M2
are **write-path** mitigations. They prevent poison being *created*; they do not
validate or clean entries that already exist. Hand-placed poison in the live
cache keys is still served, and the M5 detector still catches it (6 failures,
including "page renders 76 nodes, API returns 0"). "Can no longer be created by
a credential-free run" is proven; "can no longer exist" is not, and is not
claimed — which is why §8.4's recovery lever matters.

### 8.4 The recovery lever — verified reachable, for the tagged entries only

Because question 3 means poison outlives a redeploy, on-demand revalidation is
the primary remediation path, so it was exercised **before** any deliberate
poisoning rather than after. Verified 2026-08-10 against
`veritas-delta-pearl.vercel.app` using the `scripts/verify-admin.mjs` pattern
(temp admin provisioned via the service role, `@supabase/ssr` cookie forged,
user deleted afterwards):

- **Admin gate is genuinely enforced.** Unauthenticated
  `POST /api/revalidate` → **HTTP 401**, `{"data":null,"error":"Authentication
  required."}`.
- **The route is reachable and executes.** Authenticated
  `POST /api/revalidate {"tags":["graph","stats"]}` → **HTTP 200**,
  `{"data":{"revalidated":true,"tags":["graph","stats"],"paths":[]},"error":null}`.
  Both poison-bearing tags accepted; `revalidateTag` ran without error.
- **Recovery therefore does not require a redeploy** — which matters precisely
  because, per question 3, a redeploy would not have worked anyway.

**What was NOT established: eviction was not directly observed.** HTTP 200
confirms the handler ran and `revalidateTag` did not throw — nothing more.
Latency was measured and is **explicitly not counted as evidence**: `/api/graph`
went 235ms hot → 610ms then 546ms after the purge, elevated but never settling
back to hot, which is not a clean cold-then-warm signature. Payload comparison
cannot help either, since production data was unchanged throughout (76 nodes /
99 edges, 15 hypotheses). Actual eviction rests on documented semantics — *"The
revalidation propagates to all regions within 300ms"* — and would only be
directly provable against poison that genuinely exists, which is the thing we
declined to create.

**Scope correction (2026-08-11): this lever reaches the tagged entries only.**
`POST /api/revalidate {"tags":["graph","stats"]}` calls `revalidateTag`, and tags
exist only on entries written by `unstable_cache` — **2** of the 212 entries in a
freshly built cache (F-09b). The other **210**, written by the automatic fetch
cache while ISR pages render, carry `tags: []`. `revalidateTag` cannot reach them
at all, by construction rather than by accident. So what §8.4 verified is the
remedy for the two API routes, **not a general remedy for F-09**, and the
sentence in §8.5 calling it "the recovery lever for any entry that predates
[M1/M2]" was overstated for the same reason.

What would be needed for the other 210 — **none of it tested**:

- **`revalidatePath(path)`.** `POST /api/revalidate` already accepts `paths`, and
  `lib/revalidation.ts:36-38` already calls it for ISR pages on every admin
  write. Next documents path revalidation as invalidating the cached data for
  that route, which *should* include the fetch entries made while rendering it.
  **UNVERIFIED.** Never exercised against a known-stale entry, and it inherits
  §8.4's original objection: proving eviction requires poison that genuinely
  exists, which is the thing we declined to create. Note also that no
  `EntityKind` in `lib/revalidation.ts:17-25` maps to agents, so no write path
  revalidates `/agents` at all.
- **A full Data Cache purge** — the dashboard lever below, cache layer *Runtime
  and Data Cache*. The only listed option that certainly clears untagged entries,
  and the bluntest. **UNVERIFIED** on this project, and it carries the
  cross-project hazard documented below.
- **Discarding the build cache and redeploying.** Demonstrated to work *locally*:
  deleting `.next/cache` and rebuilding is what fixed the stale `/agents` index
  (F-09b). The Vercel equivalent is a redeploy with the build cache disabled.
  **UNVERIFIED** on Vercel — and note this is the one lever §8's question 3
  concluded a plain redeploy does *not* provide, since `.next/cache` is restored
  by default.

Until one of these is exercised against a real stale entry, the honest position
is that F-09 has a **verified** recovery lever for 2 entries and an **unverified**
one for 210.

**Backup lever.** Dashboard purge: project → **CDN** → **Caches** → **Purge
cache** → *All content* → cache layer *Runtime and Data Cache*. One hazard,
documented by Vercel: *"On Hobby and Pro, your projects share a single cache, so
purging deletes the cached data for every project in your team in that
environment."* It is not scoped to this project on those plans.

### 8.5 F-09 status — PARTIALLY RESOLVED (revised 2026-08-11)

> **Scope correction.** This subsection was written on 2026-08-10 and said
> RESOLVED. It is accurate about the two `unstable_cache` API routes and wrong
> about everything else, because it treated those two routes as the only way into
> `.next/cache/fetch-cache`. They are not: ISR pages reach the same cache through
> Next's automatic fetch cache, where neither M1's nor M2's condition can apply,
> and an instance was observed on `/agents` on 2026-08-11. See **F-09b**. The
> bullets below stand as written **for the two API routes only**.

- **Cause mitigated, on the two API routes.** M1 stops a credential-free run
  offering a value to the cache at all; M2 stops an empty-but-successful read
  being stored by a credentialed production runtime — the vector that produced
  the original incident. Shipped in `71d50c7`. Neither guard is reachable from
  an ISR page, which caches its Supabase reads below the query layer (F-09b).
- **Detection in place, and it is what caught F-09b.** `scripts/smoke.ts` asserts
  page↔API agreement and fails on an empty payload against a seeded database, so
  a recurrence cannot be silent. Verified by negative control. The ISR instance
  was caught the same way, by an assertion tightened from structural to real data
  (`161d878`) — detection generalised to the ISR path even though the mitigations
  did not. **Where that detection has to run is not arbitrary:** `ci.yml` builds
  with a cold fetch cache and structurally cannot reproduce this, so the ISR
  detector is `.github/workflows/production-smoke.yml`, against production, every
  30 minutes. See the correction in F-09b.
- **Exposure bounded on the API routes; not bounded on the ISR pages.**
  Preview→production is closed by Vercel's documented environment isolation
  (§8.2). Production→production is closed on the write path by M1/M2 **for the
  two API routes only**. `POST /api/revalidate` is verified reachable, but it
  recovers the 2 tagged entries only — `revalidateTag` cannot reach the 210
  untagged ISR entries at all, and no lever that would has been tested (§8.4).

**One status, three places.** This finding is **PARTIALLY RESOLVED**: mitigated
on the two `unstable_cache` API routes, unmitigated on the ISR pages — where, as
of 2026-08-27, the residual risk is **ACCEPTED WITH REASONING** (F-09b) rather
than simply outstanding. Accepted is not resolved, and F-09b says what is being
lived with. That is stated at the finding header, at the end of the F-09
evidence, and here — a reader landing at any of the three gets the same answer.

**Limits recorded rather than smoothed over:** environment isolation is Vercel's
documented behaviour and was deliberately not verified live (§8.2); tag eviction
was not directly observed (§8.4); recovery for the 210 untagged entries is
**UNVERIFIED** by every candidate lever (§8.4); and the precise trigger of the
F-09b instance is unrecoverable, because `.next/cache` was deleted to confirm the
diagnosis before the offending entry's age was captured. The first two are not
load-bearing for M1/M2, which hold regardless of how the platform partitions its
caches. The last two are load-bearing for F-09b, and nothing here should be read
as a fix for it.

---

## 9. F-07 — privilege provenance and the 0009 canary

### 9.1 Where the `rDxtm` bits came from

Investigated before scoping a TRUNCATE fix, because provenance decides whether a
fix is possible. Full evidence in **F-07a** above. In one line: the bits are
**Supabase platform-authored**, proven three independent ways — a `grant select`
probe yielding `anon=r` alone, the never-touched `storage` schema carrying the
same `anon=arwdDxtm` signature, and `citation_checks` (0008) matching `domains`
(0001) despite identical grant statements.

Consequence for remediation: a revoke pass would alter grants on existing
tables — the operation that caused the 0002 outage — to remove privileges that
are **not reachable** through PostgREST, while leaving the `supabase_admin`
default able to re-grant them on anything that role creates. Closed as
**accepted with reasoning, not fixed**.

### 9.2 The canary — 0009 cannot be silently reverted

The platform authored those default-ACL entries once, so the machinery to author
them again exists. 0009 removed `anon` from the `postgres`-owned default ACL for
`public` tables. **If platform tooling re-applies its baseline, that entry
returns, every subsequently created table is anon-readable again, and none of
the other 86 smoke checks notice** — they assert that public reads still *work*,
never that anon's rights stayed *absent*. The regression would surface only when
someone adds a private table and finds it already public.

`scripts/verify-agents.mjs` therefore asserts, via the Management API
(`pg_default_acl` is not in a PostgREST-exposed schema):

```
── F-07: 0009 default-privilege canary ──
✓ F-07 canary self-test: detector sees an anon= entry where one exists (storage)
✓ F-07: postgres default ACL for public tables grants anon nothing (0009 intact)
```

**Why it lives in `verify-agents.mjs` and not in `smoke.ts`.** Reading
`pg_default_acl` requires the Management API, and therefore
`SUPABASE_ACCESS_TOKEN` — a **platform-admin credential**. `scripts/smoke.ts`
must stay runnable against production on **public credentials alone**: it is the
check you want to be able to run from anywhere, by anyone, including against a
deployment you do not administer. Putting a privileged-token requirement in it
would have raised the floor for running *every* smoke check, so the canary sits
in the privileged harness instead — `verify-agents.mjs` already requires
`SUPABASE_SERVICE_ROLE_KEY` and provisions temporary admin identities, so it is
the right home for a check that needs platform-level access.

Counts after the move: **smoke 86** (public credentials), **verify-agents 40**
(privileged). Absence of the token in `verify-agents.mjs` is a **FAILURE, not a
skip** — a canary that quietly does nothing is worse than no canary, because it
reads as coverage.

### 9.3 Negative control — the assertion demonstrably fails

A guard that cannot fail is worth nothing, so the failure path is proven rather
than assumed. `storage` is a schema this repository has never written to whose
`postgres`-owned default genuinely contains an `anon=` entry — a real,
same-shape positive case requiring **nothing to be granted and nothing left
behind**. Applying the canary's exact predicate to both schemas:

```
public   -> canary PASS
         acl = {postgres=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}
         contains anon= : false

storage  -> canary FAIL
         acl = {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}
         contains anon= : true
```

That control is **wired permanently into `verify-agents.mjs`** as the self-test
above, not run once and discarded. If the Management API changes shape, the
query breaks, or the regexp stops matching, the self-test fails and tells us the
canary has gone blind — rather than the canary passing because it can no longer
see anything.

---

## 10. F-02 — what CI would look like, and what it would cost

Proposal only; no workflow file has been written. The shape is dictated by one
fact: **the harnesses split cleanly by credential, and the split does not favour
putting everything in CI.**

### 10.1 Tier 1 — no credentials at all, safe on any PR including forks

`tsc --noEmit`, `npm run lint`, `npm run validate:sql`, `node scripts/contrast.mjs`,
and `npm run build`.

The build belongs here, which is not obvious: with **no** Supabase variables set
it still succeeds — that is the credential-free path the placeholders exist for,
re-verified during F-04. It compiles every route, runs ESLint (fatal since
F-03), and typechecks, while rendering empty data. It cannot catch anything
data-dependent, but it catches everything structural, and it needs no secret.

This tier is free of risk, works on fork PRs where GitHub withholds secrets, and
would catch the majority of what actually breaks.

### 10.2 Tier 2 — `smoke` on PUBLIC values, which is better than it sounds

`smoke.ts` reads only `BASE_URL`, `SMOKE_TIMEOUT_MS`,
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` — verified after
the F-07 canary was moved out precisely to keep this true. The anon key is
public by design; it is shipped in the client bundle already. So these are not
secrets at all and can be repo *variables* rather than repo *secrets*, which
keeps them out of the secret store entirely.

**Correction (2026-08-27).** An earlier version of this paragraph claimed that
being variables rather than secrets means they *survive fork PRs*. That is
false, and it is now confirmed false from GitHub's own Actions settings page,
Variables tab: "They are not passed to workflows that are triggered by a pull
request from a fork." Variables are withheld from fork-triggered runs exactly
as secrets are. The consequence is recorded in `.github/workflows/ci.yml`: on a
fork PR, tier 1 runs normally and tier 2 fails at its required-variables guard
with all three values empty. That is the safe direction — a loud failure rather
than a green run on placeholder values — but it means tier 2 is a gate for
branches in this repository, not for fork contributions.

That makes a real PR gate possible: build with the two `NEXT_PUBLIC_*` values,
`next start`, run `smoke` against `localhost`. All 86 assertions, against real
data, on values that are already public. This is the highest-value CI step
available and it costs nothing in exposure.

**One thing it does not buy, recorded here because it was briefly assumed to.**
This gate cannot detect F-09b. The runner builds from a fresh checkout with no
`.next/cache` restored, so its fetch cache is always cold and warm-cache
staleness cannot arise in it at all. That detector is a different workflow —
`.github/workflows/production-smoke.yml`, on a clock, against production. Full
correction in F-09b.

Two caveats worth stating before anyone builds it:

- **It reads the live production database.** Read-only, anon-scoped, RLS
  enforced — but a PR gate would put steady read traffic on production.
- **Smoke against a Vercel preview URL will not work.** Preview deployments sit
  behind Vercel SSO (established while attempting the F-09 probe: every request
  returns `302 → vercel.com/sso-api`). Gating on a preview would first require a
  Protection Bypass for Automation token — which is itself a secret, moving this
  into tier 3. Building and serving inside the runner avoids that entirely.

### 10.3 Tier 3 — the privileged harnesses, which should NOT go in CI

`verify-agents` (40, needs `SUPABASE_SERVICE_ROLE_KEY` + `SUPABASE_ACCESS_TOKEN`),
`verify-suggestions` (25, service role), `verify-admin` (~20, service role).

**Recommendation: keep all three as manual pre-deploy steps.** Not because
automating them is hard, but because three separate properties make CI the wrong
venue *today*:

1. **The secret is the whole database.** `SUPABASE_SERVICE_ROLE_KEY` bypasses
   RLS completely — it is unrestricted read/write on every table, and it is what
   `verify-*` uses to create and delete auth users. Today it exists in one
   developer's `.env.local`. Putting it in GitHub Actions secrets means it is
   also readable by *any* workflow in the repository, by anyone who can merge a
   workflow change, and by every third-party action in the dependency chain of
   every job that references it. That is a material expansion of blast radius,
   not a formality, and it is not undone by rotating later — the exposure window
   is however long it sat there. `SUPABASE_ACCESS_TOKEN` is worse in kind: it is
   a *platform* credential that can alter project configuration, not just data.
2. **There is one database, and these tests mutate it.** No staging project, no
   ephemeral instance. `verify-admin` goes furthest — its last step runs
   `POST /api/contradictions/scan` and **inserts rows into live content** (which
   is why its assertion count is left unmeasured in F-02 rather than obtained by
   running it). CI would mean production data mutated on a schedule set by PR
   traffic.
3. **They are not concurrency-safe.** The harnesses provision identities from
   fixed identifiers — `verify-agents` derives emails from a constant
   `SLUG_PREFIX = "vagent-"`, and `verify-admin` uses a hardcoded
   `veritas-verify-admin@example.com`, resetting the password when the user
   already exists. Two PRs building at once would fight over the same rows and
   the same auth users, and the loser's cleanup would delete the winner's
   fixtures. Fixing that is a prerequisite to automation, independent of secrets.

**The precondition for ever moving them into CI is not "add the secret" — it is
"get a disposable database."** A Supabase branch or an ephemeral project per run
would resolve (2) and (3) at once, and would make (1) tolerable because the key
would grant access to a throwaway instance rather than production. Until that
exists, these stay manual, and that is a reasoned position rather than an
absence of one.

### 10.4 The gap this leaves, named rather than glossed

If tiers 1–2 go into CI and tier 3 stays manual, then **the F-07 canary only
runs when a human runs `verify-agents`**. That canary exists specifically to
notice a *silent* platform revert of migration 0009 — a regression with no
symptom until someone adds a private table and finds it public. A watchdog that
fires only when someone remembers to check is a weak watchdog, and it is the
clearest argument for eventually automating *something* privileged.

The cheapest resolution, if the disposable-database work is not imminent: run
the canary alone on a **schedule** rather than per-PR, as a job holding only
`SUPABASE_ACCESS_TOKEN` (not the service role, which it does not need). That is
one read-only catalog query on a timer. It still expands where a platform token
lives, so it is a trade rather than a free win — but it is a far smaller trade
than putting the service role in CI, and it restores the canary's whole purpose.

### 10.5 Honest cost summary

| Tier | Secrets needed | Fork PRs | Risk added | Recommendation |
|---|---|---|---|---|
| 1 — typecheck/lint/build/sql/contrast | none | ✅ works | none | **Do it** |
| 2 — smoke (86) | none (public *variables*) | ✅ works | read load on prod | **Do it** |
| 3 — verify-agents / suggestions / admin | service role (+ platform token) | ❌ blocked | full-DB key in CI; live mutation; races | **Keep manual** |
| Canary only, scheduled | platform token only | n/a | one token in CI | **Consider** |

Runner cost is not the constraint: tiers 1–2 are a few minutes per PR. The
constraint is entirely about which credentials leave the developer's machine.

---

## 11. Function EXECUTE surface (2026-08-28)

F-11 is one instance of a class, so the whole surface was enumerated. Every
figure below comes from the live catalog or from a live test, not from reading
the migrations.

**Re-verified 2026-09-04**, before the fix in 11.7 was proposed and before 0011
was cleared to ship. Every figure below still holds against the live catalog
(PostgreSQL 17.6, read as `postgres`) except one, which is corrected in place in
11.3 and marked there. Nothing in this section writes.

### 11.1 The open default

`0009_default_privileges.sql` closed the default privilege that granted `anon`
SELECT on future **tables**. `0001_core.sql:815` set the same kind of default for
**functions**, and 0009 did not touch it. Live `pg_default_acl`, owner
`postgres`, schema `public`:

```
objtype 'r' (tables)    -> {postgres=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}
objtype 'f' (functions) -> {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
                                                ^^^^^^^^^^^^^^ still granted
objtype 'S' (sequences) -> {postgres=rwU/postgres,anon=rU/postgres,authenticated=rU/postgres,service_role=rU/postgres}
```

`anon` was removed from the tables entry by 0009 and remains on the functions
entry. On top of that, PostgreSQL's own default grants EXECUTE to `PUBLIC` on
every new function. So a new function is executable by everyone unless a
migration explicitly revokes it — and 22 of the 28 functions in `public` are
PUBLIC-executable today.

### 11.2 Method

- Inventory and ACLs: `pg_proc` joined to `pg_namespace`, with
  `has_function_privilege()` per role.
- PUBLIC detection: `exists (select 1 from unnest(proacl) a where a::text like '=%')`
  — PUBLIC's ACL entry has an **empty grantee**. A first attempt matched `'%=X/%'`
  and produced a false positive on every `anon=X/…` entry; the figures here are
  from the corrected test.
- Breakage tests: run inside `begin; … rollback;` against the live database,
  using `set local role anon` — nothing was left changed.

### 11.3 The 18 trigger functions have no attack surface

15 are `security definer`. **17** of the 18 are PUBLIC/anon-executable by ACL —
not all 18, as this section said on 2026-08-28. `assert_council_verdict_shape()`
was already closed by `0010_council.sql:235`, and the earlier count missed it.
The 22-of-28 figure in 11.1 was and remains correct. None of the 18 is reachable,
for two independent reasons, both tested:

**They cannot be called directly.**

```
select public.log_hypothesis_insert();
ERROR:  0A000: trigger functions can only be called as triggers
```

**PostgREST does not expose them.** As `anon` against `/rest/v1/rpc/…`:

```
log_hypothesis_insert   HTTP 404 {"code":"PGRST202", …}
enforce_agent_quota     HTTP 404 {"code":"PGRST202", …}
handle_new_user         HTTP 404 {"code":"PGRST202", …}
```

**And revoking EXECUTE does not stop them firing** — the privilege is checked at
`CREATE TRIGGER`, not per row:

```
begin;
  revoke execute on function public.touch_updated_at() from public, anon, authenticated, service_role;
  revoke execute on function public.log_hypothesis_update() from public, anon, authenticated, service_role;
  update public.hypotheses set popularity = popularity where id = (select id from public.hypotheses limit 1);
  -> "update succeeded with trigger EXECUTE revoked"
rollback;
```

So the 17 open grants are **noise, not risk**. They are worth revoking for
hygiene — so that a future audit of this table has 10 rows to reason about
instead of 28 — but no finding is filed against them.

Enumerated per function, because the open default makes this a class rather than
a summary. "Holds EXECUTE" is live state on 2026-09-04. The third column is the
same three-part answer for every row above the last three — *not callable
(`0A000`), not routed by PostgREST, and revoking would not stop it firing* — so
what actually varies is what the definer context would reach if any of that were
untrue.

| Trigger function | Def | Holds EXECUTE | Intended? | If called by a role that should not have it |
|---|---|---|---|---|
| `enforce_agent_quota()` | SECDEF | PUBLIC, anon, auth, svc | No — inherited | On `suggestions`: enforces caps and domain scope and re-stamps `agent_name` from the registry. Would be the highest-value target here; all three barriers hold. |
| `guard_role_change()` | SECDEF | PUBLIC, anon, auth, svc | No — inherited | On `profiles`: the privilege-escalation guard on `role`. Same three barriers. |
| `handle_new_user()` | SECDEF | PUBLIC, anon, auth, svc | No — inherited | On `auth.users`: creates the `profiles` row. Same three barriers. |
| `on_agent_suggestion_decided()` | SECDEF | PUBLIC, anon, auth, svc | No — inherited | On `suggestions`: drives the trust recompute. Same three barriers. |
| `on_evidence_linked()` | SECDEF | PUBLIC, anon, auth, svc | No — inherited | On `hypothesis_evidence`. Same three barriers. |
| `on_evidence_unlinked()` | SECDEF | PUBLIC, anon, auth, svc | No — inherited | On `hypothesis_evidence`. Same three barriers. |
| `log_confidence_change()` | SECDEF | PUBLIC, anon, auth, svc | No — inherited | On `hypotheses`: writes `confidence_history`. Same three barriers. |
| `log_hypothesis_insert()` | SECDEF | PUBLIC, anon, auth, svc | No — inherited | On `hypotheses`. Same three barriers. |
| `log_hypothesis_update()` | SECDEF | PUBLIC, anon, auth, svc | No — inherited | On `hypotheses`. Same three barriers. |
| `log_contradiction_change()` | SECDEF | PUBLIC, anon, auth, svc | No — inherited | On `contradictions`. Same three barriers. |
| `log_evidence_insert()` | SECDEF | PUBLIC, anon, auth, svc | No — inherited | On `evidence`. Same three barriers. |
| `log_note_published()` | SECDEF | PUBLIC, anon, auth, svc | No — inherited | On `research_notes`. Same three barriers. |
| `log_question_insert()` | SECDEF | PUBLIC, anon, auth, svc | No — inherited | On `questions`. Same three barriers. |
| `log_simulation_completed()` | SECDEF | PUBLIC, anon, auth, svc | No — inherited | On `simulation_runs`. Same three barriers. |
| `assert_council_verdict_shape()` | SECDEF | svc only | **Yes** | On `councils`. The one trigger function already closed (`0010_council.sql:235`), and its trigger still fires — barrier three demonstrated in production rather than in a rolled-back test. |
| `derive_agent_enabled()` | invoker | PUBLIC, anon, auth, svc | No — inherited | On `agents`: derives `enabled` from `status`. Security **invoker**, so it carries no privilege the caller lacks even hypothetically. |
| `enforce_active_rationale()` | invoker | PUBLIC, anon, auth, svc | No — inherited | On `hypotheses`. Security invoker; no privilege of its own. |
| `touch_updated_at()` | invoker | PUBLIC, anon, auth, svc | No — inherited | On six tables (`agents`, `evidence`, `hypotheses`, `questions`, `research_notes`, `suggestions`). Security invoker; no privilege of its own. |

### 11.4 The 10 callable functions

`svc` = `service_role`, `auth` = `authenticated`. "Holds EXECUTE" is live state.

| Function | Def | Holds EXECUTE | Intended? | If called by a role that should not have it |
|---|---|---|---|---|
| `is_admin()` | SECDEF | PUBLIC, anon, auth, svc | **Yes — and required** | Returns `false` for `anon` (`auth.uid()` is null). Reads no row the caller could not reach. **Must not be revoked** — see 11.5. |
| `global_search(text,int)` | invoker | PUBLIC, anon, auth, svc | Yes (`0001:828`) | Security **invoker**, so the caller's RLS applies; it can return nothing the caller could not select directly. No bypass. |
| `suggested_confidence(uuid)` | invoker | PUBLIC, anon, auth, svc | Yes (`0001:829`) | Security **invoker**. Same reasoning. No bypass. |
| `increment_popularity(uuid)` | SECDEF | PUBLIC, anon, auth, svc | Yes (`0001:830`) | Anon can increment any hypothesis's `popularity` without limit and with no rate limit anywhere. Consequence is bounded to that one denormalized counter: **`popularity` is not a trustworthy metric and should not be read as one.** No other column is reachable. |
| `apply_suggestion(uuid,text)` | SECDEF | auth, svc | Yes | Self-guards `is_admin()` on the first line and raises `42501` otherwise, so a non-admin `authenticated` caller gets nothing. Asserted by `verify-agents.mjs` (*"agent token cannot reach the approve route → 401"*). No exposure. |
| `is_contributor()` | SECDEF | PUBLIC, anon, auth, svc | **Over-granted** | Returns `false` for `anon`; no data exposure, so this is hygiene rather than a finding. Revoking `anon`/PUBLIC breaks **nothing**, and not merely because a test passed: the only policy in `public` that references it is `suggestions."contributor insert own"`, a WITH CHECK on **INSERT**, and `anon` holds neither INSERT nor SELECT on `suggestions`. So it is never on an anon code path at all — which is a stronger statement than 11.5 can make about `is_admin()`. `authenticated` must keep it: that policy is evaluated as the caller. |
| `recompute_agent_trust(uuid)` | SECDEF | auth, svc | **Over-granted** | Only caller is the `on_agent_suggestion_decided` trigger, which needs no EXECUTE (11.3). An `authenticated` caller can force a recompute for any profile id. The value is derived from real `suggestions` rows, so it **cannot be fabricated** — but it can force a trust-floor suspension early, before the decision that would have triggered it. LOW. |
| `refresh_dashboard_stats()` | SECDEF | auth, svc | Yes, but **guard fails open** | Guard is `if auth.uid() is not null and not is_admin() then raise`. A caller with a **null** `auth.uid()` — i.e. `anon` — skips it entirely. Anon has no EXECUTE today, so the **grant is the only thing keeping anon out**; the in-function guard would not. |
| `scan_contradictions()` | SECDEF | auth, svc | Yes, but **guard fails open** | Same guard shape, and this one **writes** to `contradictions`. Same conclusion: the grant is the whole defence. |
| `propose_with_critique(…)` | SECDEF | auth, svc | **No — see F-11** | An RLS bypass: `p_proposed_by` is caller-supplied and the definer context skips the `contributor insert own` policy. Proven live with a `profiles.role = 'public'` account. |

### 11.5 `is_admin()` must keep its `anon` grant — the 0002 shape, again

Revoking EXECUTE from `anon` breaks anonymous reads on four relations, because
their RLS policies evaluate `is_admin()` for every caller:

```
begin; revoke execute on function public.is_admin() from anon, public;
       set local role anon; select count(*) from public.<rel>; rollback;

  hypotheses        BREAKS  permission denied for function is_admin
  graph_nodes       BREAKS  permission denied for function is_admin
  profiles          BREAKS  permission denied for function is_admin
  research_notes    BREAKS  permission denied for function is_admin
  (17 other anon-readable relations: ok)
```

That is `/`, `/hypotheses`, `/graph` and `/notes` — a large part of the public
site — failing exactly the way 0002 did.

**The 17 that pass are not proof of safety.** 16 anon-readable relations carry an
`is_admin()` policy (`citation_checks`, `contradictions`, `councils`,
`council_turns`, `domains`, `evidence`, `graph_edges`, `hypothesis_evidence`,
`questions`, `simulations`, `simulation_runs`, `sources`, …) and most of them
survive the revoke — presumably because the planner satisfied a permissive
`using (true)` policy first and never evaluated the other branch. That is a
**planner-dependent short-circuit, not a guarantee**: the same query could
evaluate `is_admin()` after a statistics change. Treat the four as a lower
bound, and `is_admin()`'s `anon` grant as load-bearing.

### 11.6 Does closing the function default break anything?

**No.** `ALTER DEFAULT PRIVILEGES` affects only objects created *after* it runs,
and **every existing function already carries an explicit ACL**:

```
select count(*) filter (where proacl is null) as null_acl, count(*) as total
  from pg_proc … where nspname='public';
  -> {"null_acl": 0, "total": 28}
```

So `global_search`, `suggested_confidence`, `increment_popularity` and
`is_admin` keep the grants they hold today — each is an explicit
`anon=X/postgres` entry, not an inherited default:

```
is_admin  {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
```

This is the same argument 0009 made for tables, and it should carry the same
verification block: assert those four are still anon-executable *after* the
change rather than assuming it.

**The cost is operational, and it is real.** Once the default is closed, every
future function that `anon` or `authenticated` legitimately needs must carry an
explicit `GRANT`. The dangerous case is a helper called inside an RLS policy: a
new `is_admin()`-like function with no grant would produce 11.5's failure — empty
pages, HTTP 200 — and the migration that added it would look correct. Any
migration adding such a helper must grant it and assert the grant.

### 11.7 The proposed fix — one migration, `0012_function_privileges.sql`

**Not written. Proposed here for approval first**, because it changes a default
that every future migration inherits.

**Shape: exactly 0009's, one object type over.** Close the default with an
explicit `FOR ROLE`, then revoke what is already over-granted, then verify that
what must keep working still does.

```sql
-- 1. Close the default. FOR ROLE postgres is explicit for 0009's reason:
--    without it the statement binds to the CURRENT role and can be a no-op that
--    reads like a fix. postgres owns all 28 functions in public (live check).
--    PUBLIC is in the revoke list because PostgreSQL's own built-in default
--    grants EXECUTE to PUBLIC on every new function; revoking anon and
--    authenticated alone would leave the default wide open through PUBLIC.
--    service_role is kept: it is the server's role, every function is meant to
--    be callable by it, and it holds an explicit grant on all 28 today anyway.
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

-- 2. F-11. The one finding, and the only line here that closes a live bypass.
revoke execute on function propose_with_critique(
  node_type, suggestion_operation, uuid, jsonb, text, uuid, text, text,
  critique_verdict, text, jsonb) from authenticated;

-- 3. The second over-grant from 11.4. Its only caller is a trigger, which needs
--    no EXECUTE; no application code calls it (grep of app/, lib/, scripts/).
revoke execute on function recompute_agent_trust(uuid) from authenticated;

-- 4. Hygiene, not risk (11.4). authenticated is KEPT - the suggestions INSERT
--    policy evaluates is_contributor() as the caller.
revoke execute on function is_contributor() from public, anon;

-- 5. The 17 open trigger functions (11.3). Noise, not risk: revoking EXECUTE
--    does not stop a trigger firing, which was tested under rollback and is
--    demonstrated in production by assert_council_verdict_shape.
revoke execute on function enforce_agent_quota()          from public, anon, authenticated;
revoke execute on function guard_role_change()            from public, anon, authenticated;
revoke execute on function handle_new_user()              from public, anon, authenticated;
revoke execute on function on_agent_suggestion_decided()  from public, anon, authenticated;
revoke execute on function on_evidence_linked()           from public, anon, authenticated;
revoke execute on function on_evidence_unlinked()         from public, anon, authenticated;
revoke execute on function log_confidence_change()        from public, anon, authenticated;
revoke execute on function log_contradiction_change()     from public, anon, authenticated;
revoke execute on function log_evidence_insert()          from public, anon, authenticated;
revoke execute on function log_hypothesis_insert()        from public, anon, authenticated;
revoke execute on function log_hypothesis_update()        from public, anon, authenticated;
revoke execute on function log_note_published()           from public, anon, authenticated;
revoke execute on function log_question_insert()          from public, anon, authenticated;
revoke execute on function log_simulation_completed()     from public, anon, authenticated;
revoke execute on function derive_agent_enabled()         from public, anon, authenticated;
revoke execute on function enforce_active_rationale()     from public, anon, authenticated;
revoke execute on function touch_updated_at()             from public, anon, authenticated;
```

**What it must NOT contain.** No `revoke execute on all functions in schema
public` followed by re-grants. That is the 0002 shape — revoke everything,
re-grant from memory, discover in production which one was forgotten — and
0009's header exists to say so. Every revoke above names one function.

**Untouched, deliberately:** `is_admin()` (11.5 — load-bearing for `anon`),
`global_search`, `suggested_confidence`, `increment_popularity` (the public
site), `apply_suggestion`, `scan_contradictions`, `refresh_dashboard_stats`
(called as `authenticated` — see 11.8).

**Verification block**, in 0009's style — each guard asserts a promise the
migration makes:

1. `anon` still holds EXECUTE on `is_admin`, `global_search`,
   `suggested_confidence`, `increment_popularity`.
2. `authenticated` still holds EXECUTE on `apply_suggestion`,
   `scan_contradictions`, `refresh_dashboard_stats`, `is_contributor`,
   `is_admin`.
3. `service_role` still holds EXECUTE on all 10 callable functions.
4. `anon` and `authenticated` hold EXECUTE on **neither** `propose_with_critique`
   nor `recompute_agent_trust`.
5. `pg_default_acl` for `defaclobjtype='f'`, owner `postgres`, schema `public`
   contains no `anon=`, no `authenticated=` and no PUBLIC (`=X/`) entry.

Guard 1 is the F-07/0002 guard: if it ever fails, the site serves empty pages
with HTTP 200 and nothing else reports it.

### 11.8 Does the close break anything? — the per-caller answer

11.6 answers this from the catalog: **no**, because all 28 functions carry an
explicit ACL (`count(*) filter (where proacl is null)` -> `0`), so nothing in
existence today inherits anything from the default being closed. That argument
covers the default. It does not cover the revokes in steps 2-5, so those were
checked against every call site instead.

The distinction that decides each row: `requireAgent()` builds its client with
`createAdminClient()` (`lib/api.ts:127`), so agent routes call as
**`service_role`**; `requireUser()` / `requireAdmin()` use `createClient()`
(`lib/api.ts:46,76`), so admin routes call as **`authenticated`**; the query
layer and client components call as **`anon`**.

| Function | Called from | Calls as | Effect of the proposed change |
|---|---|---|---|
| `global_search` | `lib/queries/search.ts:11`, `scripts/audit-pages.mjs:105` | anon | **None** — not touched; explicit `anon=X` retained. |
| `suggested_confidence` | `lib/queries/hypotheses.ts:136` | anon | **None** — not touched. |
| `increment_popularity` | `components/ViewTracker.tsx:16`, `lib/queries/hypotheses.ts:153` | anon | **None** — not touched. |
| `is_admin` | RLS policies on 15 anon-readable relations; `scripts/diagnose-rls.mjs:64` | anon | **None** — not touched (11.5). |
| `apply_suggestion` | `app/api/suggestions/[id]/approve/route.ts:29` | authenticated (`requireAdmin`) | **None** — `authenticated` retained. |
| `scan_contradictions` | `app/api/contradictions/scan/route.ts:13` | authenticated (`requireAdmin`) | **None** — retained. The route comment ("runs under the admin's session so the security-definer function's internal guard also passes") makes this grant deliberate. |
| `refresh_dashboard_stats` | `app/api/stats/route.ts:52` | authenticated (`requireAdmin`) | **None** — retained. |
| `is_contributor` | no call site; one INSERT WITH CHECK on `suggestions` | authenticated | **None** — `authenticated` retained, and `anon` cannot reach that policy. |
| `propose_with_critique` | `app/api/agent/suggestions/route.ts:89` | **service_role** (`requireAgent`) | **None to the app.** The only legitimate caller never used the `authenticated` grant. Closes F-11. |
| `recompute_agent_trust` | `on_agent_suggestion_decided` trigger only | — | **None** — triggers do not check EXECUTE. |
| the 17 trigger functions | their triggers | — | **None** — 11.3, three independent barriers. |

So no legitimate caller anywhere loses a privilege it uses. The revokes remove
only capability that no code path exercises.

**The cost is future, and it is real** — restated from 11.6 because it is the
reason this needs approval rather than review. After this, every new function
`anon` or `authenticated` legitimately needs must carry an explicit `GRANT`, and
the dangerous case is a new helper called inside an RLS policy: it would fail the
way 11.5 describes, as empty pages with HTTP 200, and the migration that added it
would read as correct. Any migration adding such a helper must grant **and**
assert the grant.

### 11.9 Residuals this migration cannot, or should not, close

Recorded rather than hidden, in 0009 section 2's style.

1. **`supabase_admin`'s default ACL.** `pg_default_acl` holds a second functions
   entry for schema `public`, owned by `supabase_admin`:
   `{postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin}`.
   Any function `supabase_admin` creates in `public` is anon-executable, and
   `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin` cannot run as `postgres`
   (not a member, not superuser). Identical to 0009's table residual and equally
   latent: `supabase_admin` owns 0 of the 28 functions.
2. **0009 closed the table default for `anon` only.** The live entry is
   `{postgres=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}`
   — every future table in `public` is still granted **ALL** to `authenticated`
   by default. RLS contains that for a table that enables RLS; a future table
   that forgets to is readable and writable by any signed-in account. Same class,
   different object type, and out of scope for a migration about functions -
   raised here so it is on the record rather than rediscovered later.
3. **The sequence default is untouched:**
   `objtype 'S' -> {postgres=rwU/postgres,anon=rU/postgres,authenticated=rU/postgres,service_role=rU/postgres}`.
   `anon` can read every future sequence's current value. Low consequence, same
   class, not fixed here.

### 11.10 Ordering against 0011

0011's `revoke execute on function ia_apply_sanction(...) from public, anon,
authenticated` stays, and stays load-bearing. Migrations apply in filename order,
so on any fresh database 0011 runs **before** 0012 and creates
`ia_apply_sanction` while the default is still open — its own revoke is the only
thing standing between a visitor and `agents.status` at that moment. Pushed
together against the live database, the same order holds.

What does need amending is one sentence of prose. 0011's grants comment says the
functions default "is still open today", which stops being true the moment 0012
applies; it should point forward to 0012 rather than state an open condition as
permanent. That is a comment edit, not a behaviour change, and 0011's
verification block already asserts its revoke took effect regardless of what the
default does.
