# SECURITY REVIEW — AUDIT.md F-01 exposure check

Branch: `chore/next-16-upgrade` · commit `c8ab9ef` · 2026-08-10
**No upgrade has been run.** This is the exposure check only.

> **Headline: the premise of this branch's name is wrong.**
> `npm audit` reports the `next` advisory as one merged range,
> `9.3.4-canary.0 - 16.3.0-preview.10`, which reads as "only Next 16 fixes it".
> Read individually, **all eight `next` advisories are patched in 15.5.21** — a
> patch release on the 15.x line. Installed is **15.5.19**; the latest 15.x is
> **15.5.23**. A patch bump inside Next 15 clears every one of them.
> The Next 15 → 16 major is **not required** for the `next` CVEs.

---

## 1. The four advisories, individually

`npm audit` groups by package. Expanded, they are 15 distinct advisories across
4 packages.

### Package 1 — `next` (8 advisories)

Installed: **`next@15.5.19`** (`node_modules/next/package.json`).
Every one is patched in **15.5.21** and again in **16.2.11**.

| GHSA | CVE | Title | Affected | Patched |
|---|---|---|---|---|
| GHSA-m99w-x7hq-7vfj | CVE-2026-64641 | DoS in App Router using Server Actions | `>=13.0.0, <15.5.21`; `>=16.0.0, <16.2.11` | 15.5.21 / 16.2.11 |
| GHSA-89xv-2m56-2m9x | CVE-2026-64649 | SSRF in Server Actions on custom servers | `>=14.1.1, <15.5.21`; `>=16.0.0, <16.2.11` | 15.5.21 / 16.2.11 |
| GHSA-68g3-v927-f742 | CVE-2026-64648 | Cache confusion of response bodies (requests with bodies) | `>=13.0.0, <15.5.21`; `>=16.0.0, <16.2.11` | 15.5.21 / 16.2.11 |
| GHSA-4633-3j49-mh5q | CVE-2026-64647 | Cache confusion, non-UTF-8 body charset | `>=13.0.0, <15.5.21`; `>=16.0.0, <16.2.11` | 15.5.21 / 16.2.11 |
| GHSA-4c39-4ccg-62r3 | CVE-2026-64646 | Unbounded Server Action payload in Edge runtime | `>=13.0.0, <15.5.21`; `>=16.0.0, <16.2.11` | 15.5.21 / 16.2.11 |
| GHSA-p9j2-gv94-2wf4 | CVE-2026-64645 | SSRF in `rewrites()` via attacker-controlled destination host | `>=12.0.0, <15.5.21`; `>=16.0.0, <16.2.11` | 15.5.21 / 16.2.11 |
| GHSA-q8wf-6r8g-63ch | CVE-2026-64644 | DoS in Image Optimization API using SVGs | `>=15.5.0, <15.5.21`; `>=16.0.0, <16.2.11` | 15.5.21 / 16.2.11 |
| GHSA-955p-x3mx-jcvp | CVE-2026-64643 | Unauthenticated disclosure of internal Server Function endpoints | `>=13.0.0, <15.5.21`; `>=16.0.0, <16.2.11` | 15.5.21 / 16.2.11 |

### Package 2 — `postcss` (4 advisories) — TWO copies installed

| Copy | Version | Vulnerable? |
|---|---|---|
| `node_modules/postcss` | **8.5.15** | yes (`<=8.5.22`) |
| `node_modules/next/node_modules/postcss` | **8.4.31** | yes — pinned *exactly* by `next` |

GHSA-qx2v-qp2m-jg93 (XSS via unescaped `</style>` in stringify output);
GHSA-6g55-p6wh-862q, GHSA-fxqj-rqcc-2cmp (arbitrary `.map` file read via
attacker-controlled `sourceMappingURL`); GHSA-r28c-9q8g-f849 (path traversal in
previous-source-map auto-loading). Affected `<=8.5.22`; latest is **8.5.26**.

### Package 3 — `sharp` (1 advisory group)

Installed **`sharp@0.34.5`**; affected `<0.35.0`; latest **0.35.3**.
GHSA-f88m-g3jw-g9cj — inherited libvips CVE-2026-33327, CVE-2026-33328,
CVE-2026-35590, CVE-2026-35591. `next@15.5.23` declares `sharp: ^0.34.3`
(optional dependency), so 0.35.x is outside its declared range.

### Package 4 — `nanoid` (2 advisories)

Installed **`nanoid@3.3.12`** (transitive, via `postcss`); affected `<=3.3.16`;
latest 3.x is **3.3.18**. GHSA-28wg-ghj8-5hjv (non-secure generators loop
indefinitely on negative size); GHSA-2v37-7h3g-55p8 (custom generators loop
indefinitely when size is zero).

---

## 2 & 3. Is *this* app exposed?

### The preconditions this app does not meet

| Feature | Present? | Evidence |
|---|---|---|
| Server Actions (`"use server"`) | **NO** | `grep -rn '"use server"' app lib components` → NONE FOUND |
| `"use cache"` | **NO** | `grep -rn '"use cache"' app lib components` → NONE FOUND |
| `next/image` | **NO** | `grep -rn 'from "next/image"' app components lib` → NONE FOUND |
| Image Optimization | **DISABLED** | `next.config.ts:7` — `images: { unoptimized: true }` |
| Edge runtime | **NO** | `grep -rn 'runtime = "edge"' app` → NONE FOUND |
| `rewrites()` / `redirects()` | **NO** | `next.config.ts` contains only the `images` key |
| Custom server | **NO** | no `server.js` / `server.ts` / `server.mjs` at root |
| Hosting | **Vercel-managed** | live at `veritas-delta-pearl.vercel.app`; no `vercel.json`, no standalone output |
| Middleware | **YES** | `middleware.ts:4-6` — but no advisory below names middleware as a precondition |

### Verdict per advisory

| CVE | Verdict | Evidence |
|---|---|---|
| CVE-2026-64641 — DoS via Server Actions | **NOT EXPOSED** | Advisory: *"Applications using Pages Router or not using Server Actions are not vulnerable."* No `"use server"` in the codebase. |
| CVE-2026-64649 — SSRF, Server Actions on custom servers | **NOT EXPOSED** (two independent reasons) | Requires Server Actions (absent) **and** an unpinned host header. Advisory: *"Managed hosting pins the host upstream and is not affected; `next start` and standalone output do the same from version 14.2 onward."* This app is Vercel-managed with no custom server. |
| CVE-2026-64648 — cache confusion, requests with bodies | **NOT EXPOSED in app code** | Requires the pattern `fetch(new Request(init), aDifferentInit)`; `fetch(new Request(init), init)` is stated as safe. `grep -rn "new Request(" lib app components` → NONE FOUND. The app is App Router, so the router precondition *is* met — the exploit pattern is what is absent. **UNVERIFIED:** `@supabase/supabase-js` issues its own POST/PATCH internally; I did not audit its call sites. It calls `fetch(url, init)`, not `fetch(Request, differentInit)`, so the documented pattern is unlikely, but I did not read its source. |
| CVE-2026-64647 — cache confusion, non-UTF-8 body charset | **NOT EXPOSED** | Additionally requires request bodies in a charset other than UTF-8 (e.g. UTF-16). Every request body this app sends is `JSON.stringify` output with `Content-Type: application/json` (e.g. `app/api/agent/citations/route.ts`, `scripts/agent-lib/agent-client.mjs:20`), which is UTF-8. |
| CVE-2026-64646 — unbounded Server Action payload, Edge | **NOT EXPOSED** | Requires *both* a Server Action *and* the Edge runtime. Neither exists. |
| CVE-2026-64645 — SSRF via rewrites | **NOT EXPOSED** | Requires `rewrites()`/`redirects()` with a destination hostname built from user input. `next.config.ts` declares neither. |
| CVE-2026-64644 — image optimization SVG DoS | **NOT EXPOSED** | Advisory verbatim: *"If you are using `config.images.unoptimized: true`, you are NOT impacted."* `next.config.ts:7` sets exactly that. |
| CVE-2026-64643 — Server Function endpoint disclosure | **NOT EXPOSED** | Requires *"App Router, Server Actions (`use server`) or `use cache` endpoints."* Neither directive appears anywhere. |
| postcss ×4 | **NOT EXPOSED at runtime** | postcss runs at **build time only**, over CSS this repo authors (`app/globals.css` + Tailwind output). All four advisories need attacker-controlled CSS or an attacker-controlled `sourceMappingURL`. No user-supplied CSS enters the build. Residual risk is limited to a supply-chain compromise of our own CSS toolchain. |
| sharp ×4 (libvips) | **NOT EXPOSED** | `sharp` is Next's image-optimizer backend. With `images: { unoptimized: true }` (`next.config.ts:7`) and zero `next/image` imports, the optimizer never runs, so no attacker-supplied bytes reach libvips. |
| nanoid ×2 | **NOT EXPOSED** | Pulled in by `postcss` for source-map identifiers — build time, called with internal fixed sizes. Both advisories require an attacker-controlled `size` argument. |

**Summary: 0 of 15 advisories are exposed in this deployment**, on the evidence
above. One item carries an UNVERIFIED caveat (supabase-js internals under
CVE-2026-64648).

Two caveats on that conclusion, stated plainly:

1. "Not exposed" is a statement about *today's* configuration. Adding one
   `"use server"` directive re-opens five of the eight `next` CVEs at once.
   That is a thin margin to rely on.
2. I assessed reachability, not correctness of the advisories. I did not attempt
   to exploit anything.

---

## 4. Can this be fixed without the Next 15 → 16 major?

**Mostly yes.** Three of the four packages are fixable by patch/minor bumps.

| Target | Fix without major? | How |
|---|---|---|
| `next` (all 8 CVEs) | **YES** | `next@15.5.23` — a **patch** bump from 15.5.19. All eight are patched in 15.5.21. |
| `postcss` (top-level, 8.5.15) | **YES** | Lockfile bump to **8.5.26**. `package.json` already declares `^8.4.49`, so this is in-range — it needs only `npm update postcss`, no manifest edit. |
| `nanoid` (3.3.12) | **YES** | Lockfile bump to **3.3.18** (patch), transitively via `postcss`. |
| `postcss` nested in `next` (8.4.31) | **NO — needs `overrides`** | `next@15.5.23` pins `postcss: "8.4.31"` exactly (verified via `npm view`). Only an npm `overrides` entry can move it on the 15.x line. |
| `sharp` (0.34.5) | **NO — needs `overrides`** | `next@15.5.23` declares `sharp: "^0.34.3"`; 0.35.x is outside that range. |

And the major, for comparison:

```
next@16.3.0 postcss: 8.5.23      ← fixed (>8.5.22)
next@16.3.0 sharp:   ^0.35.3     ← fixed (>=0.35.0)
```

So `next@16.3.0` is the only version that clears the **nested** `postcss` and
`sharp` without `overrides` — those two are precisely what the major buys.
Given both are assessed NOT EXPOSED (build-time-only CSS; image optimizer
disabled), that is a small return for a major framework migration.

### Three options, with what each actually achieves

| | Change | Clears | Leaves | Risk |
|---|---|---|---|---|
| **A** | `next@15.5.23` + `npm update postcss nanoid` | all 8 `next` CVEs; top-level postcss; nanoid | nested `postcss@8.4.31`, `sharp@0.34.5` — both NOT EXPOSED | **Low.** Patch/minor only, no API surface change. |
| **B** | A + npm `overrides` for `postcss@^8.5.26` and `sharp@^0.35.3` | all 15 | nothing | **Medium.** `overrides` forces versions outside what `next` declares — unsupported by the maintainer, and `sharp` carries native bindings. Needs a real build to prove. |
| **C** | `next@16.3.0` | all 15 | nothing | **Highest.** Major migration across 45 pages and 30 route handlers, on a branch that merges to a production-deploying `master`. |

**My recommendation: option A**, and reassess if a `"use server"` directive is
ever added. It removes every advisory this app is actually reachable through,
using only patch and minor bumps, and it makes `npm audit` quieter without
pretending the residual two are gone — they would still be reported, and should
be recorded as knowingly accepted with the reasoning above.

If you would rather have a clean `npm audit`, option B is the cheaper route to
it than C, but its `overrides` need a build and a smoke run to trust.

**Nothing has been changed.** No install, no upgrade, no lockfile edit. The
branch contains only this file.
