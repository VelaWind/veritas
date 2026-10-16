-- ═══════════════════════════════════════════════════════════════════════════
-- VERITAS — 0014_function_search_path.sql   (AUDIT.md §12, Advisor WARN sweep)
--
-- Pin search_path on the nine functions the Supabase Advisor reports as
-- `function_search_path_mutable`. Every other function in public already pins
-- it; these nine are the ones written without the clause, all security INVOKER:
--
--   trigger functions   touch_updated_at, enforce_active_rationale,
--                       derive_agent_enabled, agent_audits_guard_insert,
--                       agent_audits_guard_update
--   callable (sql)      global_search, suggested_confidence,
--                       agent_status_rank, audit_findings_severity
--
-- THE SETTING IS `public`, THE REPO'S ONE CONVENTION. ia_apply_sanction (0011)
-- and every security-definer function since 0001 declare `set search_path =
-- public`. No second convention is introduced here.
--
-- WHY `public` AND NOT `public, extensions` FOR ANY OF THE NINE. The risk with
-- pinning is a body that calls an extension function unqualified and silently
-- stops resolving once search_path no longer reaches `extensions` (pgcrypto and
-- uuid-ossp live there on this project). Each of the nine was read from the live
-- catalog (pg_get_functiondef, 2026-10-16) and none does: every call is either a
-- pg_catalog builtin — now(), ts_headline, websearch_to_tsquery, ts_rank,
-- jsonb_typeof, jsonb_array_elements, jsonb_array_length, round, sqrt, greatest,
-- least, coalesce — or a reference to a public table or type (hypotheses,
-- questions, evidence, hypothesis_evidence, sources, node_type, audit_severity,
-- agent_status). pg_catalog is searched implicitly whatever search_path says, so
-- `public` reaches all of it. `gen_random_uuid()` appears only in a column
-- DEFAULT on agent_audits, not in any of these bodies, and is core since PG13.
--
-- ALTER, NOT CREATE OR REPLACE. ALTER FUNCTION ... SET changes proconfig and
-- nothing else: body, volatility and ACL are untouched, so no grant can be lost
-- by restating a definition from memory (the 0002 shape). The verification block
-- asserts the grants anyway rather than relying on that.
--
-- KNOWN SIDE EFFECT, ACCEPTED. A SQL function carrying a SET clause is never
-- inlined by the planner. That applies to global_search, suggested_confidence,
-- agent_status_rank and audit_findings_severity. At this project's row counts
-- (tens of hypotheses; audit_findings_severity runs once per agent_audits write
-- through the agent_audits_severity_derived CHECK) the cost is not measurable.
-- The CHECK keeps working — rehearsed under rollback against the live database,
-- AUDIT.md §12.
--
-- Depends on 0001 (touch_updated_at, enforce_active_rationale, global_search,
-- suggested_confidence), 0007 (derive_agent_enabled), 0011 (agent_status_rank),
-- 0013 (audit_findings_severity, the two agent_audits guards). Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

alter function touch_updated_at()                    set search_path = public;
alter function enforce_active_rationale()            set search_path = public;
alter function derive_agent_enabled()                set search_path = public;
alter function agent_audits_guard_insert()           set search_path = public;
alter function agent_audits_guard_update()           set search_path = public;
alter function global_search(text, integer)          set search_path = public;
alter function suggested_confidence(uuid)            set search_path = public;
alter function agent_status_rank(agent_status)       set search_path = public;
alter function audit_findings_severity(jsonb)        set search_path = public;


-- ── Verification — each guard asserts a promise made above ────────────────
--
-- 1. All nine carry exactly search_path=public.
-- 2. Nothing lost EXECUTE. anon keeps the two the public site calls — losing
--    either is the 0002 failure: /search and the hypothesis page go quiet with
--    HTTP 200. authenticated and service_role keep what they held before
--    (live ACLs read 2026-10-16).
-- 3. The two pure functions still compute what the CHECK and the sanction
--    ladder depend on.
do $$
declare
  fn    text;
  v_msg text := '';
  nine text[] := array[
    'public.touch_updated_at()',
    'public.enforce_active_rationale()',
    'public.derive_agent_enabled()',
    'public.agent_audits_guard_insert()',
    'public.agent_audits_guard_update()',
    'public.global_search(text,integer)',
    'public.suggested_confidence(uuid)',
    'public.agent_status_rank(public.agent_status)',
    'public.audit_findings_severity(jsonb)'
  ];
  anon_keep text[] := array[
    'public.global_search(text,integer)',   -- lib/queries/search.ts:11
    'public.suggested_confidence(uuid)'     -- lib/queries/hypotheses.ts:136
  ];
  auth_keep text[] := array[
    'public.global_search(text,integer)',
    'public.suggested_confidence(uuid)',
    'public.agent_status_rank(public.agent_status)',   -- 0011 grant
    'public.audit_findings_severity(jsonb)'
  ];
begin
  -- 1. The setting took, on every one.
  foreach fn in array nine loop
    if not exists (
      select 1 from pg_proc
       where oid = fn::regprocedure
         and proconfig = array['search_path=public']
    ) then
      v_msg := v_msg || format('%s does not carry exactly search_path=public; ', fn);
    end if;
  end loop;

  -- 2. Grants, asserted rather than assumed.
  foreach fn in array anon_keep loop
    if not has_function_privilege('anon', fn, 'EXECUTE') then
      v_msg := v_msg || format('anon LOST EXECUTE on %s; ', fn);
    end if;
  end loop;
  foreach fn in array auth_keep loop
    if not has_function_privilege('authenticated', fn, 'EXECUTE') then
      v_msg := v_msg || format('authenticated LOST EXECUTE on %s; ', fn);
    end if;
  end loop;
  foreach fn in array nine loop
    if not has_function_privilege('service_role', fn, 'EXECUTE') then
      v_msg := v_msg || format('service_role LOST EXECUTE on %s; ', fn);
    end if;
  end loop;

  -- 3. Still resolves its types and still computes.
  if audit_findings_severity('[{"severity":"concern"},{"severity":"notice"}]'::jsonb)
       is distinct from 'concern'::audit_severity then
    v_msg := v_msg || 'audit_findings_severity no longer returns the worst grade; ';
  end if;
  if not (agent_status_rank('active') < agent_status_rank('throttled')
      and agent_status_rank('throttled') < agent_status_rank('suspended')) then
    v_msg := v_msg || 'agent_status_rank ladder is no longer ordered; ';
  end if;

  if v_msg <> '' then
    raise exception
      '0014 guard: %Refusing to apply. An anon EXECUTE loss is the 0002 failure '
      'shape — pages render empty with HTTP 200 and nothing else reports it.', v_msg;
  end if;

  raise notice '0014: search_path pinned on % functions; grants intact.', array_length(nine, 1);
end $$;
