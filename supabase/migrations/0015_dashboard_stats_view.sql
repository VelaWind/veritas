-- ═══════════════════════════════════════════════════════════════════════════
-- VERITAS — 0015_dashboard_stats_view.sql   (AUDIT.md F-16, §12.2)
--
-- dashboard_stats stops being a materialized view and becomes a plain view,
-- `security_invoker = on`. A plain view cannot go stale, so the refresh
-- obligation F-16 found unmet since 2026-06-11 stops existing rather than
-- being scheduled.
--
-- WHY NOT KEEP IT MATERIALIZED AND SCHEDULE A REFRESH. The view is seven
-- subqueries over tens of rows. Materializing it bought nothing measurable and
-- created a duty — refresh after every write — that only an admin button
-- discharged, and nobody pressed it for four months. A pg_cron job would have
-- needed a new extension plus an age assertion to notice when the job itself
-- stopped. Removing the mechanism removes both.
--
-- WHY security_invoker = on. Every relation it reads is anon-readable
-- (hypotheses, evidence, questions, simulation_runs, contradictions, domains),
-- so the reader's own RLS applies and the view can return nothing the reader
-- could not count directly. That is graph_nodes' arrangement (0001), not
-- agent_public's (0007): here no base table is admin-only, so nothing needs the
-- owner's rights. One consequence, stated rather than discovered: the
-- per-domain count in activity_by_domain is evaluated under the reader's RLS,
-- so for anon it excludes drafts (the public hypotheses policy hides them),
-- where the matview, running as owner, counted them. With 0 drafts live
-- (2026-10-16) the figures are identical; with drafts, the public figure is now
-- the one consistent with total_hypotheses. The definition is otherwise
-- unchanged.
--
-- refreshed_at IS DROPPED. On a plain view it would be now() at read time — a
-- column claiming a refresh that never happened. /dashboard no longer prints it.
--
-- refresh_dashboard_stats() IS DROPPED. `refresh materialized view` on a plain
-- view is an error, so the function would be a broken admin action. Its callers
-- (POST /api/stats, the admin "Refresh dashboard stats" button) are removed in
-- the same change. It also removes one of the Advisor's
-- authenticated_security_definer_function_executable lines, and with it the
-- fails-open guard §12.2 had to document.
--
-- 0002_fix_rls.sql:116 and 0001 still create and refresh the matview on a fresh
-- database; this file runs after them and replaces it. seed.sql no longer
-- refreshes it.
--
-- Depends on 0001 (the matview, the function), 0009 (which lists dashboard_stats
-- among the anon-readable relations it verifies). Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
begin
  -- Guarded: `drop materialized view if exists` ERRORS when the name is a plain
  -- view, so an unconditional drop would make this file fail on a re-run.
  if exists (select 1 from pg_class
              where oid = to_regclass('public.dashboard_stats') and relkind = 'm') then
    drop materialized view public.dashboard_stats;
  end if;
end $$;

drop function if exists refresh_dashboard_stats();

create or replace view dashboard_stats with (security_invoker = on) as
select
  (select count(*) from hypotheses where state <> 'draft')          as total_hypotheses,
  (select count(*) from evidence)                                   as total_evidence,
  (select count(*) from questions where status = 'unknown')         as open_questions,
  (select count(*) from simulation_runs)                            as total_simulation_runs,
  (select count(*) from contradictions where not resolved)          as open_contradictions,
  (select jsonb_object_agg(bucket, n) from (
     select width_bucket(confidence, 0, 100, 5) as bucket, count(*) as n
     from hypotheses where state <> 'draft' group by 1) b)           as confidence_distribution,
  (select jsonb_agg(row_to_json(t)) from (
     select d.name, count(h.id) as n from domains d
     left join hypotheses h on h.domain_id = d.id
     group by d.name order by n desc) t)                             as activity_by_domain;

-- Explicit, because 0009 closed the default that used to grant anon SELECT on
-- every new relation. Without this line /dashboard and the home page fail with
-- 42501 — the 0002 shape.
grant select on dashboard_stats to anon, authenticated, service_role;


-- ── Verification — each guard asserts a promise made above ────────────────
--
-- 1. It is a plain view with security_invoker = on — not a matview, and not an
--    owner-rights view (which the Advisor would rightly flag as ERROR).
-- 2. anon can SELECT it, and as anon it returns exactly one row. This is the
--    0002 guard: if it fails, the dashboard and home page break.
-- 3. The refresh function is gone, so no admin action points at an error.
do $$
declare
  v_msg  text := '';
  v_rows int;
begin
  if not exists (select 1 from pg_class
                  where oid = 'public.dashboard_stats'::regclass
                    and relkind = 'v'
                    and 'security_invoker=on' = any (coalesce(reloptions, '{}'))) then
    v_msg := v_msg || 'dashboard_stats is not a plain security_invoker view; ';
  end if;

  if not has_table_privilege('anon', 'public.dashboard_stats', 'SELECT') then
    v_msg := v_msg || 'anon cannot SELECT dashboard_stats; ';
  else
    execute 'set local role anon';
    select count(*) into v_rows from public.dashboard_stats;
    execute 'reset role';
    if v_rows <> 1 then
      v_msg := v_msg || format('dashboard_stats returns %s rows to anon, expected 1; ', v_rows);
    end if;
  end if;

  if to_regprocedure('public.refresh_dashboard_stats()') is not null then
    v_msg := v_msg || 'refresh_dashboard_stats() still exists; ';
  end if;

  if v_msg <> '' then
    raise exception
      'F-16 guard: %Refusing to apply. An anon read failure here is the 0002 '
      'shape — /dashboard and / stop rendering their numbers.', v_msg;
  end if;

  raise notice 'F-16: dashboard_stats is a plain security_invoker view; anon reads 1 row; refresh function dropped.';
end $$;
