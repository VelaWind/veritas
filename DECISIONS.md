# DECISIONS

Running log of implementation decisions made while building Veritas V1.0
against `veritas-architecture-v1.md`. Spec deviations are marked **[deviation]**;
everything else is a choice the spec left open.

## Phase 0 — Foundation

- **Next.js 15 (App Router)** — spec says "Next.js 14+"; 15 is current stable
  with React 19 and the async `params`/`cookies()` APIs. All code uses the
  Next 15 conventions.
- **Tailwind CSS 3.4** — the spec's folder structure includes
  `tailwind.config.ts`, which is the v3 configuration model (v4 moved to
  CSS-first config). Staying on v3 keeps the file layout exactly as specced.
- **No Docker on the build machine** — `supabase start` could not be run
  locally (CLI v2.104 present, Docker absent). The migration and seed were
  validated by close review against PostgreSQL 15 semantics instead;
  README documents how to apply them with the CLI against a real project.
- **Env fallbacks for buildability** — Supabase client factories fall back to
  placeholder credentials when env vars are absent, and all public-page
  queries catch connection errors and return empty results, so
  `npm run build` (which prerenders ISR pages) succeeds with no live
  database. With real credentials the same pages render seed data.
- **Markdown rendering** via `react-markdown` + `remark-gfm` with a
  hand-rolled `.markdown` stylesheet (no typography plugin) so prose colors
  stay on design tokens.
- **Fonts** via `next/font/google` (Spectral 300/500, Inter 400/500/600,
  IBM Plex Mono 400/500), self-hosted at build time by Next.

## Migration (0001_core.sql) — spec fixes, all marked in-file

- **[deviation] Fixed SQL syntax error in §2.6** — the spec's
  `create trigger trg_confidence on hypotheses before update on hypotheses…`
  names the table twice, which does not parse. Implemented as
  `create trigger trg_confidence before update on hypotheses…`.
- **Added `unique (hypothesis_a, hypothesis_b, kind)` to `contradictions`** —
  §2.7's `scan_contradictions()` relies on `on conflict do nothing`, which
  silently never conflicts without a unique constraint, producing duplicate
  rows on every scan. The constraint makes the scan idempotent as intended.
- **Added the `enforce_active_rationale` trigger** — §2.3 comments that a
  non-empty `confidence_rationale` is "REQUIRED … before state='active'
  (trigger below)" but the trigger is never shown. Implemented it.
- **Added lifecycle timeline triggers** — §2.1 defines event types
  (`hypothesis_created`, `hypothesis_updated`, `hypothesis_status_changed`,
  `evidence_added`, `evidence_unlinked`, `question_added`, `note_published`,
  `contradiction_detected`, `contradiction_resolved`, `simulation_completed`)
  that no specced trigger emits, while principle §1.2-2 requires every change
  to emit timeline events from the write path. Added security-definer
  triggers for each so history is genuinely a byproduct of writes.
- **Added `graph_nodes` view** — §1.2-3 references a uniform node identity
  view by name; defined it as a union over the five node types.
- **Added `refresh_dashboard_stats()` + `increment_popularity()` RPCs** —
  the matview needs a security-definer refresh hook callable from the API,
  and `hypotheses.popularity` ("view counter") needs an anon-callable
  incrementer; neither had DDL in the spec.
- **`dashboard_stats` is created `with no data` and refreshed in seed** —
  the matview is defined before any rows exist; the seed (and the admin
  "refresh stats" action) populate it.
