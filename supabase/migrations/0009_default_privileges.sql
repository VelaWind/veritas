-- ═══════════════════════════════════════════════════════════════════════════
-- VERITAS — 0009_default_privileges.sql   (AUDIT.md F-07)
--
-- Close the open default: stop `anon` inheriting rights on every FUTURE table
-- in schema public. 0001_core.sql:806-807 set
--     alter default privileges in schema public grant select on tables to anon;
-- so every table created since has been anon-readable unless someone remembered
-- an explicit REVOKE. Four migrations remembered (0003, 0006 ×2, 0007, 0008).
-- The next one to forget ships a private table to the public internet.
--
-- WHAT THIS MIGRATION DOES NOT DO — read this before editing.
-- It does NOT touch grants on any EXISTING relation. Not one GRANT, not one
-- REVOKE. 0002_fix_rls.sql exists because RLS was enabled with no matching
-- GRANT, every row was silently denied to anon, and the site served empty pages
-- with HTTP 200 for weeks. A revoke-and-regrant migration is exactly how that
-- is reintroduced. Default privileges affect only objects created AFTER this
-- runs, so existing public reads cannot be affected by the ALTER below. The
-- verification block at the end proves that rather than assuming it.
--
-- Depends on 0001. Idempotent (ALTER DEFAULT PRIVILEGES is declarative).
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. The fix ─────────────────────────────────────────────────────────────
--
-- FOR ROLE is named EXPLICITLY and deliberately. `ALTER DEFAULT PRIVILEGES`
-- without FOR ROLE silently defaults to the CURRENT role, which produces a
-- default-ACL entry that only ever applies to objects that role creates. If the
-- role that actually creates tables is a different one, the statement is a no-op
-- that reads in review like a fix. It must therefore name the real creator.
--
-- The real creator here is `postgres`, established from live state, not from the
-- migration files:
--   select pg_get_userbyid(relowner), count(*) from pg_class ... nspname='public'
--     -> postgres | 24   (all 21 tables + 3 views + 1 matview; no other owner)
-- Migrations run through `supabase db push` connect as postgres, and every
-- relation in public is postgres-owned, so this entry is the one that binds.
--
-- ALL, not just SELECT: the live default ACL for anon is `rDxtm/postgres`
-- (SELECT, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN), not SELECT alone. Revoking
-- only SELECT would leave a future table TRUNCATE-able by anon, which RLS does
-- not restrain. The intent is that a future table is private to anon until
-- someone grants it deliberately.
alter default privileges for role postgres in schema public
  revoke all on tables from anon;


-- ── 2. The residual this migration CANNOT close, recorded rather than hidden ─
--
-- pg_default_acl holds a SECOND entry for tables in schema public, owned by
-- `supabase_admin`, and it is more permissive than the one above:
--   owning_role     | obj_type | acl
--   postgres        | tables   | {... anon=rDxtm/postgres ...}
--   supabase_admin  | tables   | {... anon=arwdDxtm/supabase_admin ...}   <- ALL
--
-- If supabase_admin ever creates a table in public, that table is granted ALL
-- to anon and the statement above does nothing about it, because default ACLs
-- are keyed on the creating role.
--
-- It is NOT altered here because this migration provably cannot alter it:
--   pg_has_role('postgres','supabase_admin','MEMBER') -> false
--   pg_roles.rolsuper for postgres                    -> false
-- ALTER DEFAULT PRIVILEGES FOR ROLE requires membership in that role (or
-- superuser). Running it as postgres fails outright, which would abort this
-- migration. Wrapping it in an exception handler so the migration "succeeds"
-- would be a soft failure of precisely the kind DECISIONS.md is a catalogue of,
-- so it is left undone and visible instead:
--
--   -- CANNOT RUN AS postgres — requires supabase_admin or a superuser:
--   -- alter default privileges for role supabase_admin in schema public
--   --   revoke all on tables from anon;
--
-- Live exposure today is nil: supabase_admin owns 0 of the 24 relations in
-- public. This is a latent path, not an active one. Closing it needs a session
-- as supabase_admin (Supabase dashboard SQL editor / support), and is tracked
-- separately rather than pretended away here.


-- ── 3. Verification — fail loudly if public reads were broken ───────────────
--
-- Every relation below is one an UNAUTHENTICATED page genuinely reads, each
-- tied to a call site in the query layer (see AUDIT.md F-07 keep-public list).
-- This block asserts anon still holds SELECT on all of them. It should pass
-- trivially today, because section 1 touches only future objects — its purpose
-- is to make the 0002 failure impossible to reintroduce silently if anyone ever
-- adds a REVOKE to this file. An empty site with HTTP 200 is the failure this
-- guards against, and it is the one that hides best.
do $$
declare
  keep_public text[] := array[
    'domains',              -- lib/queries/domains.ts:14      <- app/(public)/page.tsx:4
    'hypotheses',           -- lib/queries/hypotheses.ts:26   <- app/(public)/page.tsx:5
    'questions',            -- lib/queries/questions.ts:24    <- app/(public)/page.tsx:6
    'evidence',             -- lib/queries/evidence.ts:23     <- app/(public)/evidence/page.tsx:3
    'sources',              -- embed lib/queries/evidence.ts:20-21,48  source:sources(*)
    'hypothesis_evidence',  -- embed lib/queries/hypotheses.ts:70      links:hypothesis_evidence(...)
    'confidence_history',   -- embed lib/queries/hypotheses.ts:72      history:confidence_history(*)
    'contradictions',       -- lib/queries/contradictions.ts:14 <- app/(public)/dashboard/page.tsx:5
    'timeline_events',      -- lib/queries/timeline.ts:19     <- app/(public)/timeline/page.tsx:3
    'research_notes',       -- lib/queries/notes.ts:9         <- app/(public)/notes/page.tsx:4
    'simulations',          -- lib/queries/simulations.ts:14  <- app/(public)/lab/page.tsx:4
    'simulation_runs',      -- embed lib/queries/simulations.ts:14,35  runs:simulation_runs(*)
    'graph_edges',          -- lib/queries/graph.ts:55        <- app/(public)/graph/page.tsx:3
    'citation_checks',      -- lib/queries/citations.ts:20    <- app/(public)/evidence/[slug]/page.tsx:14
    'dashboard_stats',      -- lib/queries/stats.ts:14        <- app/(public)/dashboard/page.tsx:4
    'agent_public',         -- lib/queries/agents.ts:24       <- app/(public)/agents/page.tsx:4
    'agent_public_stats'    -- lib/queries/agents.ts:25       <- app/(public)/agents/page.tsx:4
  ];
  rel      text;
  missing  text[] := '{}';
begin
  foreach rel in array keep_public loop
    if to_regclass('public.' || rel) is null then
      missing := missing || (rel || ' (relation absent)');
    elsif not has_table_privilege('anon', 'public.' || rel, 'SELECT') then
      missing := missing || (rel || ' (anon lost SELECT)');
    end if;
  end loop;

  if array_length(missing, 1) is not null then
    raise exception
      'F-07 guard: anon can no longer read %. This is the 0002 failure shape — '
      'RLS/grants misaligned, every row denied, pages render empty with HTTP 200. '
      'Refusing to apply.', array_to_string(missing, ', ');
  end if;

  raise notice 'F-07: anon SELECT intact on all % keep-public relations.',
    array_length(keep_public, 1);
end $$;
