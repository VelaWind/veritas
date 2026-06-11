-- ═══════════════════════════════════════════════════════════════════════════
-- VERITAS — 0002_fix_rls.sql  (corrective migration)
--
-- Fixes a production bug where public reads returned an empty list. Root cause
-- diagnosed against the live DB: every base table returned SQL state 42501
-- "permission denied for table" for BOTH the anon and service_role roles —
-- a missing table-level GRANT, evaluated BEFORE RLS. (The home-page stats
-- worked because 0001 granted the dashboard_stats matview explicitly but never
-- granted the base tables, relying on Supabase default privileges that did not
-- apply in this project.) The app's query layer swallows the error and returns
-- [], which is why it looked like an RLS row filter rather than a privilege
-- error.
--
-- This migration is idempotent and safe to apply to an existing database
-- WITHOUT a reset. It also folds in three hardening fixes (all mirrored into
-- 0001_core.sql so a fresh `db reset` produces the same end state):
--   1. Table/sequence/function GRANTs to anon, authenticated, service_role
--      (+ default privileges for future objects).
--   2. is_admin() made explicitly null-safe.
--   3. Public-read policies on hypotheses and research_notes restructured so
--      the public condition stands on its own (no is_admin() in the read path).
--   4. scan_contradictions() casts 'system'::actor_type (a bare literal under
--      SELECT DISTINCT resolves to text, and there is no implicit text->enum
--      cast, so the insert would fail 42804).
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. The fix: table-level privileges (the actual bug) ─────────────────────

grant usage on schema public to anon, authenticated, service_role;

grant select on all tables in schema public to anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;

grant usage, select on all sequences in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;

-- Future objects inherit the same grants.
alter default privileges in schema public
  grant select on tables to anon;
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant all on tables to service_role;
alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant execute on functions to anon, authenticated, service_role;

-- Matviews are NOT covered by GRANT ... ON ALL TABLES.
grant select on dashboard_stats to anon, authenticated, service_role;
grant select on graph_nodes to anon, authenticated, service_role;

-- Keep maintenance functions away from anon (they also self-guard).
revoke execute on function scan_contradictions() from anon;
revoke execute on function refresh_dashboard_stats() from anon;

-- ─── 2. Null-safe is_admin() ─────────────────────────────────────────────────

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

-- ─── 3. Public-read policies stand on their own ──────────────────────────────

drop policy if exists "public read" on hypotheses;
drop policy if exists "admin write" on hypotheses;
drop policy if exists "public read non-draft" on hypotheses;
drop policy if exists "admin all" on hypotheses;
create policy "public read non-draft" on hypotheses
  for select using (state <> 'draft');
create policy "admin all" on hypotheses
  for all using (is_admin()) with check (is_admin());

drop policy if exists "public read" on research_notes;
drop policy if exists "admin write" on research_notes;
drop policy if exists "public read published" on research_notes;
drop policy if exists "admin all" on research_notes;
create policy "public read published" on research_notes
  for select using (published);
create policy "admin all" on research_notes
  for all using (is_admin()) with check (is_admin());

-- ─── 4. scan_contradictions(): cast 'system' to actor_type ───────────────────

create or replace function scan_contradictions() returns int
language plpgsql security definer set search_path = public as $$
declare inserted int := 0;
begin
  if auth.uid() is not null and not is_admin() then
    raise exception 'Only admins may run the contradiction scan.';
  end if;

  insert into contradictions (hypothesis_a, hypothesis_b, kind, explanation, detected_by)
  select distinct least(a.hypothesis_id, b.hypothesis_id),
         greatest(a.hypothesis_id, b.hypothesis_id),
         'evidential',
         'These hypotheses draw opposite conclusions from the same evidence.',
         'system'::actor_type
  from hypothesis_evidence a
  join hypothesis_evidence b
    on a.evidence_id = b.evidence_id
   and a.relation = 'supports' and b.relation = 'opposes'
   and a.hypothesis_id <> b.hypothesis_id
  on conflict do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end $$;

revoke execute on function scan_contradictions() from public, anon;
grant execute on function scan_contradictions() to authenticated, service_role;

-- ─── Refresh the dashboard so stats reflect the now-readable tables ──────────
refresh materialized view dashboard_stats;
select scan_contradictions();
