-- ═══════════════════════════════════════════════════════════════════════════
-- VERITAS — 0012_function_privileges.sql   (AUDIT.md F-11 and §11)
--
-- Close the open default for FUNCTIONS, and revoke what it has already handed
-- out. This is 0009 applied one object type over.
--
-- 0009 closed the default that granted `anon` rights on every FUTURE TABLE in
-- schema public. `0001_core.sql:815` set the same kind of default for
-- FUNCTIONS, and 0009 did not touch it. Live `pg_default_acl`, owner postgres,
-- schema public, read 2026-09-04:
--
--   objtype 'r' (tables)    -> {postgres=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}
--   objtype 'f' (functions) -> {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--                                                   ^^^^^^^^^^^^^^ still granted
--
-- On top of that, PostgreSQL's own built-in default grants EXECUTE to PUBLIC on
-- every new function. So a new function in this schema is executable by
-- everyone the instant it is created, and 22 of the 28 functions in public are
-- PUBLIC-executable today because of it.
--
-- That is a class, not an incident. F-11 is the one instance of it that is a
-- live security bug: `propose_with_critique()` is security definer, takes
-- `p_proposed_by` from the caller, and `authenticated` holds EXECUTE on it
-- purely because nobody revoked the inherited default. Any signed-in account can
-- insert an agent-attributed `suggestions` row that RLS refuses on the direct
-- path. The full surface — all 28 functions, who holds EXECUTE, whether that is
-- intended, and what each could do in the wrong hands — is AUDIT.md §11.
--
-- WHAT THIS MIGRATION DOES NOT DO — read this before editing.
-- It does NOT contain `revoke execute on all functions in schema public`
-- followed by re-grants. That is the 0002 shape: revoke everything, re-grant
-- from memory, discover in production which one was forgotten. 0002 exists
-- because RLS was enabled with no matching GRANT and the site served empty pages
-- with HTTP 200 for weeks. Every revoke below names exactly one function, and
-- the verification block asserts that everything which must keep working still
-- does, rather than assuming it.
--
-- Depends on 0001 (the functions), 0008 (propose_with_critique), 0010
-- (assert_council_verdict_shape, already closed there), 0011 (which closes its
-- own function explicitly, and must — see §11.10 and 0011's grants note: this
-- file applies AFTER 0011, so 0011 still creates ia_apply_sanction while the
-- default is open). Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. Close the default ───────────────────────────────────────────────────
--
-- FOR ROLE is named EXPLICITLY, for 0009's reason: `ALTER DEFAULT PRIVILEGES`
-- without FOR ROLE silently binds to the CURRENT role, producing an entry that
-- only ever applies to objects that role creates. If the real creator is a
-- different role, the statement is a no-op that reads in review like a fix.
--
-- The real creator is `postgres`, established from live state:
--   select pg_get_userbyid(proowner), count(*) from pg_proc ... nspname='public'
--     -> postgres | 28   (all 28 functions; no other owner)
--
-- PUBLIC IS IN THE REVOKE LIST AND MUST BE. PostgreSQL grants EXECUTE to PUBLIC
-- on every new function by its own built-in default, independently of anything
-- in pg_default_acl. Revoking `anon, authenticated` alone would remove the two
-- named entries and leave the door open through PUBLIC — a fix that verifies as
-- "anon is no longer listed" while anon can still execute. Guard 5 at the end
-- checks for the PUBLIC entry specifically, using the empty-grantee test from
-- §11.2, because a naive `like '%=X/%'` matches every `anon=X/...` entry and
-- reports a false positive.
--
-- `service_role` IS KEPT, deliberately. It is the server's role: every function
-- in this schema is meant to be callable by it, it already holds an explicit
-- grant on all 28, and route handlers reach the security-definer functions
-- through it (`createAdminClient()`, lib/api.ts:127). Revoking it here would buy
-- nothing and would make every future migration carry a grant that is always
-- correct — the kind of boilerplate that stops being read.
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;


-- ── 2. F-11 — the one line that closes a live bypass ───────────────────────
--
-- `propose_with_critique` is security definer, so it runs as `postgres` and the
-- `contributor insert own` policy on `suggestions`
--   check ((proposed_by = auth.uid()) and status = 'pending' and is_contributor())
-- is never evaluated for the insert it performs. `p_proposed_by` and
-- `p_agent_name` are caller-supplied. Proven live against a fresh account with
-- `profiles.role = 'public'`: the direct INSERT is refused 42501, the same
-- payload through the RPC is accepted and attributed to a real agent.
--
-- 0008:110 revoked `public, anon` and never revoked `authenticated`, so the
-- `authenticated=X/postgres` entry in its ACL is section 1's default made
-- explicit at CREATE time — not a grant anyone decided to write.
--
-- The application does not lose anything. Its only caller is
-- app/api/agent/suggestions/route.ts:89, reached through requireAgent(), which
-- builds its client with createAdminClient() and therefore calls as
-- `service_role` (AUDIT.md §11.8).
revoke execute on function propose_with_critique(
  node_type, suggestion_operation, uuid, jsonb, text, uuid, text, text,
  critique_verdict, text, jsonb
) from authenticated;


-- ── 3. The second over-grant (§11.4) ───────────────────────────────────────
--
-- `recompute_agent_trust` is security definer and its only caller is the
-- `on_agent_suggestion_decided` trigger, which needs no EXECUTE at all (§11.3).
-- No application code calls it. With the inherited grant, any signed-in account
-- can force a recompute for any profile id: the value derives from real
-- `suggestions` rows so it cannot be fabricated, but it can trip a trust-floor
-- suspension early, before the decision that would have caused it.
revoke execute on function recompute_agent_trust(uuid) from authenticated;


-- ── 4. Hygiene, not risk (§11.4) ───────────────────────────────────────────
--
-- `is_contributor()` returns false for `anon`, so there is no data exposure and
-- no finding was filed. It is revoked because anon has no reason to hold it, and
-- this is safe for a structural reason rather than because a test passed: the
-- only policy in public that references it is the WITH CHECK on `suggestions`
-- INSERT, and `anon` holds neither INSERT nor SELECT on `suggestions`.
--
-- `authenticated` IS KEPT. That policy is evaluated as the calling role, so a
-- contributor inserting their own suggestion must be able to execute it.
--
-- Contrast `is_admin()`, which is NOT touched anywhere in this file: 15
-- anon-readable relations carry it in a SELECT policy, and revoking anon's grant
-- breaks /, /graph, /notes and /hypotheses in exactly the 0002 shape — empty
-- pages, HTTP 200 (§11.5). Guard 1 asserts it survived.
revoke execute on function is_contributor() from public, anon;


-- ── 5. The 17 open trigger functions (§11.3) ───────────────────────────────
--
-- Noise, not risk, and revoked as hygiene: so that the next audit of this
-- surface has 10 rows to reason about instead of 28.
--
-- None of these is reachable, for three independent reasons, all tested:
--   * `select public.log_hypothesis_insert();` -> ERROR 0A000, trigger functions
--     can only be called as triggers;
--   * PostgREST does not route them (HTTP 404 PGRST202 as anon);
--   * EXECUTE is checked at CREATE TRIGGER, not per row, so revoking it does not
--     stop a trigger firing — verified under `begin; ... rollback;`, and
--     demonstrated in production by assert_council_verdict_shape(), which
--     0010:235 already revoked and whose trigger has fired ever since.
--
-- That third point is why this section is safe. It is also why it is only
-- hygiene: these grants were never an attack surface, they were an inventory
-- problem.
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


-- ── 6. The residuals this migration cannot, or should not, close ───────────
--
-- Recorded rather than hidden, in 0009 §2's style. All three are AUDIT.md §11.9.
--
-- (a) supabase_admin holds a SECOND default-ACL entry for functions in public:
--       {postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin}
--     Any function supabase_admin creates in public is anon-executable, and
--     section 1 does nothing about it, because default ACLs are keyed on the
--     creating role. It is NOT altered here because this migration provably
--     cannot alter it — ALTER DEFAULT PRIVILEGES FOR ROLE requires membership:
--       pg_has_role('postgres','supabase_admin','MEMBER') -> false
--       pg_roles.rolsuper for postgres                    -> false
--     Running it would abort this migration; catching the exception so the
--     migration "succeeds" would be the soft failure DECISIONS.md catalogues. So
--     it is left undone and visible:
--
--       -- CANNOT RUN AS postgres — requires supabase_admin or a superuser:
--       -- alter default privileges for role supabase_admin in schema public
--       --   revoke execute on functions from public, anon, authenticated;
--
--     Live exposure today is nil: supabase_admin owns 0 of the 28 functions in
--     public. Latent, not active — exactly as for 0009's table residual.
--
-- (b) 0009 closed the TABLE default for `anon` only. The live entry still reads
--     {postgres=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres},
--     so every future table in public is granted ALL to `authenticated` by
--     default. RLS contains that for a table that enables RLS; a future table
--     that forgets to is readable and writable by any signed-in account. Same
--     class, different object type. Out of scope for a migration about
--     functions, and recorded here so it is not rediscovered by accident.
--
-- (c) The SEQUENCE default is untouched:
--       objtype 'S' -> {postgres=rwU/postgres,anon=rU/postgres,authenticated=rU/postgres,service_role=rU/postgres}
--     anon can read every future sequence's current value. Low consequence, same
--     class, not fixed here.


-- ── 7. Verification — five guards, each asserting a promise made above ─────
--
-- Guard 1 is the F-07/0002 guard and the reason this block exists at all. If
-- anon loses EXECUTE on a function the public site calls, or on is_admin()
-- (which 15 anon-readable relations evaluate in their SELECT policies), the
-- failure is empty pages with HTTP 200 — the failure that hides best, and the
-- one this repository has already shipped once.
do $$
declare
  fn    text;
  v_msg text := '';
  v_acl aclitem[];
  anon_keep text[] := array[
    'public.is_admin()',                    -- §11.5 load-bearing: RLS on 15 relations
    'public.global_search(text,integer)',   -- lib/queries/search.ts:11
    'public.suggested_confidence(uuid)',    -- lib/queries/hypotheses.ts:136
    'public.increment_popularity(uuid)'     -- components/ViewTracker.tsx:16
  ];
  auth_keep text[] := array[
    'public.is_admin()',
    'public.is_contributor()',              -- suggestions INSERT policy, as the caller
    'public.apply_suggestion(uuid,text)',   -- app/api/suggestions/[id]/approve/route.ts:29
    'public.scan_contradictions()',         -- app/api/contradictions/scan/route.ts:13
    'public.refresh_dashboard_stats()'      -- app/api/stats/route.ts:52
  ];
  svc_keep text[] := array[
    'public.is_admin()',
    'public.is_contributor()',
    'public.global_search(text,integer)',
    'public.suggested_confidence(uuid)',
    'public.increment_popularity(uuid)',
    'public.apply_suggestion(uuid,text)',
    'public.scan_contradictions()',
    'public.refresh_dashboard_stats()',
    'public.recompute_agent_trust(uuid)',
    'public.propose_with_critique(public.node_type,public.suggestion_operation,uuid,jsonb,text,uuid,text,text,public.critique_verdict,text,jsonb)'
  ];
  closed text[] := array[
    'public.propose_with_critique(public.node_type,public.suggestion_operation,uuid,jsonb,text,uuid,text,text,public.critique_verdict,text,jsonb)',
    'public.recompute_agent_trust(uuid)'
  ];
begin
  -- 1. The public site still works.
  foreach fn in array anon_keep loop
    if not has_function_privilege('anon', fn, 'EXECUTE') then
      v_msg := v_msg || format('anon LOST EXECUTE on %s; ', fn);
    end if;
  end loop;

  -- 2. The admin routes still work. They call as `authenticated`, not
  --    service_role: requireAdmin() uses createClient() (lib/api.ts:76).
  foreach fn in array auth_keep loop
    if not has_function_privilege('authenticated', fn, 'EXECUTE') then
      v_msg := v_msg || format('authenticated LOST EXECUTE on %s; ', fn);
    end if;
  end loop;

  -- 3. The server can still call everything it is supposed to.
  foreach fn in array svc_keep loop
    if not has_function_privilege('service_role', fn, 'EXECUTE') then
      v_msg := v_msg || format('service_role LOST EXECUTE on %s — a route would be dead on arrival; ', fn);
    end if;
  end loop;

  -- 4. The two over-grants are actually gone. This is F-11's closure, asserted
  --    rather than assumed.
  foreach fn in array closed loop
    if has_function_privilege('anon', fn, 'EXECUTE') then
      v_msg := v_msg || format('anon can still EXECUTE %s; ', fn);
    end if;
    if has_function_privilege('authenticated', fn, 'EXECUTE') then
      v_msg := v_msg || format('authenticated can still EXECUTE %s — F-11 IS NOT CLOSED; ', fn);
    end if;
  end loop;

  -- 5. The default itself is closed. Element-wise, not a LIKE over the whole
  --    ACL text: PUBLIC's entry has an EMPTY grantee, so it is the element whose
  --    text starts with '=', and a `like '%=X/%'` over the joined text matches
  --    every `anon=X/...` entry instead (§11.2 — that false positive is why this
  --    is spelled out).
  select d.defaclacl into v_acl
    from pg_default_acl d
    join pg_namespace n on n.oid = d.defaclnamespace
   where d.defaclobjtype = 'f'
     and n.nspname = 'public'
     and pg_get_userbyid(d.defaclrole) = 'postgres';

  if not found then
    -- The row is deleted when the default ACL becomes identical to PostgreSQL's
    -- built-in one, and the built-in one grants EXECUTE to PUBLIC. Its absence
    -- would therefore mean the default is open again, not that it is closed.
    v_msg := v_msg || 'the postgres/functions/public default-ACL entry is GONE, '
                   || 'which means the built-in default (EXECUTE to PUBLIC) applies again; ';
  else
    if exists (select 1 from unnest(v_acl) e where e::text like 'anon=%') then
      v_msg := v_msg || 'the functions default still grants anon; ';
    end if;
    if exists (select 1 from unnest(v_acl) e where e::text like 'authenticated=%') then
      v_msg := v_msg || 'the functions default still grants authenticated; ';
    end if;
    if exists (select 1 from unnest(v_acl) e where e::text like '=%') then
      v_msg := v_msg || 'the functions default still grants PUBLIC; ';
    end if;
  end if;

  if v_msg <> '' then
    raise exception
      'F-11/§11 guard: %Refusing to apply. An anon or authenticated EXECUTE loss '
      'is the 0002 failure shape — pages render empty with HTTP 200 and nothing '
      'else reports it.', v_msg;
  end if;

  raise notice
    'F-11: function default closed (public, anon, authenticated); '
    'propose_with_critique and recompute_agent_trust are service_role-only; '
    'anon keeps % site functions, authenticated keeps % admin functions.',
    array_length(anon_keep, 1), array_length(auth_keep, 1);
end $$;

