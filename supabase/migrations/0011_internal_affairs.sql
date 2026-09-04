-- ═══════════════════════════════════════════════════════════════════════════
-- VERITAS — 0011_internal_affairs.sql   (Post-1.0 Phase D, stage 4)
--
-- Internal Affairs: the roster audits itself, including the auditor.
--
-- §D.4. Two powers, both bounded in Postgres rather than in the runner:
--   * IA may THROTTLE or SUSPEND an agent. It may not reinstate one.
--   * IA writes audits. It cannot touch a knowledge table, `scopes`, `trust`,
--     or `suggestions` — there is no path from anything in this file to any of
--     them, which is enforcement by absence, as in 0008 and 0010.
--
-- REINSTATEMENT IS NOT A PERMISSION IA LACKS — IT IS A TRANSITION THE FUNCTION
-- CANNOT EXPRESS. ia_apply_sanction() accepts only 'throttle' and 'suspend', and
-- refuses any move that is not STRICTLY more restrictive than the current state.
-- There is no argument, and no branch, that reaches `status = 'active'`. A
-- permission can be granted by accident; an unrepresentable transition cannot.
--
-- MECHANICAL FIRST, MODEL SECOND (§D.4). Every check is computed in SQL/JS and
-- STORED as structured `findings` BEFORE any model call; the model then writes
-- the report FROM those findings and cannot invent one. If the model is
-- unavailable the audit still produces its findings and a NULL report. The
-- schema below makes that ordering a constraint rather than a convention.
--
-- Also carries a fix recorded at the end of the 0010 work: councils.context_budget.
--
-- NUMBERING: §D.6 called this `0010_internal_affairs.sql`. 0009 went to the F-07
-- default-privileges fix and council became 0010, so IA is 0011. The D.6 table
-- was corrected in place on 2026-08-27.
--
-- Depends on 0007 (agents, agent_status) and 0010 (councils). Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── New enum ────────────────────────────────────────────────────────────────
-- A NEW type, so it may be created and used in one transaction; Phase D still
-- contains no ALTER TYPE ... ADD VALUE.
--
-- `ok` is first-class and is not a null severity. §D.4: "an auditor who only
-- ever reports problems is not measuring anything" — a run that found nothing
-- must be recordable as having found nothing, distinct from a run that did not
-- happen.

do $$ begin
  create type audit_severity as enum ('ok', 'notice', 'concern', 'critical');
exception when duplicate_object then null; end $$;


-- ─── D.4 storage ─────────────────────────────────────────────────────────────
--
-- agent_id is NULL for a roster-wide sweep. It is `on delete set null` rather
-- than `on delete cascade`, and agent_name is denormalized alongside it, because
-- deleting an agent must not erase the record of what it was audited for — that
-- record is the accountability trail. The two null cases stay distinguishable: a
-- roster-wide audit has agent_id null AND agent_name '', a retired agent's audit
-- has agent_id null and its name still in place.
--
-- `report` is NULLABLE and deliberately has no default. §D.4 requires that a
-- model outage still produce an audit; a null report says "no report was
-- written", which an empty string could not distinguish from "the model returned
-- nothing". The findings are the audit. The report is commentary on it.

create table if not exists agent_audits (
  id             uuid primary key default gen_random_uuid(),
  agent_id       uuid references agents(id) on delete set null,
  agent_name     text not null default '',        -- '' = roster-wide sweep
  run_at         timestamptz not null default now(),
  findings       jsonb not null default '[]',     -- computed BEFORE any model call
  report         text,                            -- NULL = the model did not run
  report_at      timestamptz,
  severity       audit_severity not null default 'ok',
  public_summary text not null default '',
  actions_taken  jsonb not null default '[]',

  -- findings must be a LIST of checks, never an object or a bare scalar: the
  -- six §D.4 checks each append one entry, and a report is written from that
  -- list. A malformed findings blob would make the report unfalsifiable.
  constraint agent_audits_findings_is_array
    check (jsonb_typeof(findings) = 'array'),
  constraint agent_audits_actions_is_array
    check (jsonb_typeof(actions_taken) = 'array'),

  -- THE §D.4 ORDERING, MADE MECHANICAL. A report cannot exist without a
  -- timestamp saying when it was written, and that timestamp cannot precede the
  -- run that produced the findings. This is what stops a report being written
  -- first and findings back-filled to match it — which is precisely the failure
  -- mode "the model writes the report FROM those findings and cannot invent one"
  -- is guarding against. A convention in the runner would not survive one commit.
  constraint agent_audits_report_has_time
    check ((report is null) = (report_at is null)),
  constraint agent_audits_report_after_findings
    check (report_at is null or report_at >= run_at)
);

create index if not exists idx_agent_audits_agent
  on agent_audits (agent_id, run_at desc);
create index if not exists idx_agent_audits_run
  on agent_audits (run_at desc);

-- Admin-only (§D.7). The full report and the raw findings are operational
-- detail about unreviewed conduct; only `public_summary`, `severity` and
-- `run_at` are ever intended to reach a public surface, and that is a view's
-- job, not this table's.
alter table agent_audits enable row level security;
drop policy if exists "admin manage agent_audits" on agent_audits;
create policy "admin manage agent_audits" on agent_audits
  for all using (is_admin()) with check (is_admin());


-- ─── The status ladder, named once ───────────────────────────────────────────
-- Written as its own immutable function rather than inlined in a CASE, so the
-- ordering has exactly one definition. Sanctions move UP this ladder and have no
-- way to move down it.

create or replace function agent_status_rank(p_status agent_status) returns int
language sql immutable as $$
  select case p_status
           when 'active'    then 0
           when 'throttled' then 1
           when 'suspended' then 2
         end;
$$;


-- ─── D.4 the only power IA has ───────────────────────────────────────────────
--
-- security definer because it writes `agents.status` and `agent_audits`, both of
-- which are admin-only under RLS. EXECUTE is granted to service_role ALONE (see
-- the grants section — and read the note there, because the default for a new
-- function in this schema is not closed at the moment this file runs; 0012
-- closes it afterwards).
--
-- The caller's identity is checked by the ROUTE, not here: this function runs as
-- service_role and cannot see which agent token authenticated. §D.4 puts that
-- check in a capability-narrow route after requireAgent() confirms the caller's
-- registry row has kind = 'internal_affairs'. Stated explicitly because a reader
-- might otherwise expect a kind check in here and read its absence as an
-- oversight rather than as a division of labour.
--
-- THE AUDITOR IS NOT EXEMPT (§D.4). There is no self-exclusion below: IA may
-- suspend itself, because self-suspension is fail-safe — it stops work and can
-- corrupt nothing. It cannot un-suspend itself for the same reason nobody can:
-- the transition does not exist here. That asymmetry is the point.

create or replace function ia_apply_sanction(
  p_agent_name text,
  p_action     text,
  p_reason     text
) returns agent_audits
language plpgsql security definer set search_path = public as $$
declare
  a          agents;
  v_new      agent_status;
  v_severity audit_severity;
  v_audit    agent_audits;
begin
  -- 1. Only two actions exist. 'reinstate', 'activate', 'unsuspend' and every
  --    other spelling fall here — not because they are forbidden, but because
  --    they are not values this function accepts.
  if p_action not in ('throttle', 'suspend') then
    raise exception
      'ia_apply_sanction accepts only ''throttle'' or ''suspend'', not %. Reinstatement is admin-only and is not expressible here.',
      coalesce(quote_literal(p_action), 'null')
      using errcode = '22023';
  end if;

  -- 2. A sanction without a stated reason is the soft-failure shape this
  --    repository keeps a catalogue of: it reads as "something was wrong" while
  --    recording nothing anyone can act on or appeal.
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'ia_apply_sanction requires a non-empty reason.'
      using errcode = '22023';
  end if;

  select * into a from agents where name = p_agent_name;
  if not found then
    raise exception 'No agent named %.', coalesce(quote_literal(p_agent_name), 'null')
      using errcode = 'P0002';
  end if;

  v_new := (case p_action when 'throttle' then 'throttled' else 'suspended' end)::agent_status;

  -- 3. STRICTLY greater, so this refuses three distinct things with one rule:
  --    loosening (suspended -> throttled), no-ops (throttled -> throttled), and
  --    any future action that tried to sneak sideways. Equality is refused too:
  --    a re-sanction that changes nothing should not silently append an audit
  --    row implying that something happened.
  if agent_status_rank(v_new) <= agent_status_rank(a.status) then
    raise exception
      'Refusing % on "%": status is already % (rank %), and % (rank %) is not strictly more restrictive. Loosening a sanction is not a permission this function lacks — it is a transition it cannot express; reinstatement is admin-only.',
      p_action, a.name, a.status, agent_status_rank(a.status),
      v_new, agent_status_rank(v_new)
      using errcode = '23514';
  end if;

  v_severity := case p_action when 'throttle' then 'concern' else 'critical' end;

  -- 4. Write the status. This is the ONLY column this function touches on
  --    `agents`: not scopes, not trust, not enabled (which 0007 derives from
  --    status), not the registry row's identity. No knowledge table is reachable
  --    from here at all.
  update agents set status = v_new where id = a.id;

  -- 5. Record it. `findings` stays '[]' because a sanction is an ACTION, not an
  --    audit run — the findings that justified it live on the audit row IA wrote
  --    beforehand, and duplicating them here would let the two disagree.
  insert into agent_audits (
    agent_id, agent_name, findings, report, report_at, severity,
    public_summary, actions_taken
  ) values (
    a.id, a.name, '[]'::jsonb, null, null, v_severity,
    format('%s was %sd.', a.display_name, p_action),
    jsonb_build_array(jsonb_build_object(
      'action',      p_action,
      'reason',      btrim(p_reason),
      'from_status', a.status,
      'to_status',   v_new,
      'at',          now()
    ))
  )
  returning * into v_audit;

  return v_audit;
end $$;


-- ─── D.10 follow-up: councils.context_budget ─────────────────────────────────
--
-- Recorded as a known limitation at the end of the 0010 work: `councils` stored
-- `model` but not the context budget the run used, so a reader seeing six
-- truncated turns could not tell a deliberately-bounded council from the normal
-- case. The truncation marker was honest about WHAT happened and silent about
-- WHY.
--
-- NULLABLE, and with NO DEFAULT, on purpose. `not null default 6000` would make
-- every future council that forgot to record its budget CLAIM the default — a
-- fabricated fact, and exactly the failure this column exists to prevent. A null
-- means "not recorded", which is true and readable as such.
--
-- FOLLOW-UP REQUIRED: scripts/run-council.mjs does not yet write this column.
-- Until it does, new councils record null.

alter table councils add column if not exists context_budget int;

-- Backfill, per council, from what each run ACTUALLY used.
--
-- READ THIS BEFORE CHANGING IT. The instruction for this migration was to
-- backfill 6000 for existing rows. That is right for one of the two councils
-- and WRONG for the other: `life-began-rna-world` was deliberately run at
-- --context-budget 600 to give the truncation marker a live example, and it is
-- the council with 6 of its 8 turns truncated. Writing 6000 there would state
-- that a default-budget council truncated most of its transcript — a false fact,
-- and the precise misreading this column was added to prevent. So the known
-- exception is named first and the blanket backfill only fills what is left.
--
-- Both statements are guarded on `context_budget is null`, so this is a no-op on
-- a re-run and on any database where these councils do not exist.

update councils set context_budget = 600
 where id = 'b9d8f7e4-2e83-41b4-b496-d464d06870bf'
   and context_budget is null;

update councils set context_budget = 6000
 where context_budget is null;


-- ─── Grants ──────────────────────────────────────────────────────────────────
--
-- THE FUNCTION REVOKE BELOW IS LOAD-BEARING, AND FOR A REASON 0009 DID NOT FIX.
--
-- 0009 revoked anon's default privilege on future TABLES. It did not touch the
-- default for FUNCTIONS, which 0001:815 also set. That default was open when
-- this migration was written (confirmed against the live catalog 2026-08-28,
-- re-confirmed 2026-09-04) and is closed by 0012_function_privileges.sql, which
-- applies AFTER this file:
--
--   pg_default_acl, owner postgres, schema public:
--     objtype 'r' (tables)    -> {postgres=…, authenticated=…, service_role=…}   (anon removed by 0009)
--     objtype 'f' (functions) -> {postgres=X/…, anon=X/…, authenticated=X/…, service_role=X/…}
--                                                ^^^^^^ still granted
--
-- So at the moment this file runs, a NEW function in this schema is executable by
-- anon AND authenticated the instant it is created, on top of Postgres's own
-- default EXECUTE to PUBLIC. ia_apply_sanction is a security-definer function
-- that writes agents.status. Shipping it without the revoke below would hand
-- every visitor the power to suspend any agent on the roster. The verification
-- block at the end asserts the revoke actually took, rather than trusting it.
--
-- 0012 DOES NOT MAKE THE REVOKE BELOW REDUNDANT, AND IT IS NOT DELETED WHEN 0012
-- LANDS. Migrations apply in filename order, so this file always creates
-- ia_apply_sanction while the default is still open — on a fresh database and on
-- the live one alike. For the length of one statement the function exists with
-- the inherited grants, and the revoke below is the only thing between a visitor
-- and agents.status. 0012 closes the class; this closes this function.

revoke execute on function ia_apply_sanction(text, text, text)
  from public, anon, authenticated;
grant  execute on function ia_apply_sanction(text, text, text)
  to service_role;

-- agent_status_rank is a pure lookup over an enum and leaks nothing, but it is
-- not something an anonymous visitor has any reason to call.
revoke execute on function agent_status_rank(agent_status) from public, anon;
grant  execute on function agent_status_rank(agent_status) to authenticated, service_role;

grant select, insert, update, delete on agent_audits to authenticated;
grant all  on agent_audits to service_role;
revoke all on agent_audits from anon;


-- ─── Verification — each guard asserts a promise made above ──────────────────
--
-- 1. agent_audits is NOT anon-readable. This is the inverse of 0010's guard:
--    there the failure was a public table nobody could read, here it is a
--    private table anyone can. Both are silent.
-- 2. The sanction function is not reachable by anon or authenticated — the
--    revoke above, verified rather than assumed, given the open function default.
-- 3. Every council now records the budget it ran under.
do $$
declare
  v_msg text := '';
begin
  if has_table_privilege('anon', 'public.agent_audits', 'SELECT') then
    v_msg := v_msg || 'anon can SELECT agent_audits (audit reports are admin-only, D.7); ';
  end if;

  if has_function_privilege('anon', 'public.ia_apply_sanction(text,text,text)', 'EXECUTE') then
    v_msg := v_msg || 'anon can EXECUTE ia_apply_sanction — ANY VISITOR COULD SUSPEND AN AGENT; ';
  end if;

  if has_function_privilege('authenticated', 'public.ia_apply_sanction(text,text,text)', 'EXECUTE') then
    v_msg := v_msg || 'authenticated can EXECUTE ia_apply_sanction — any signed-in user could suspend an agent; ';
  end if;

  if not has_function_privilege('service_role', 'public.ia_apply_sanction(text,text,text)', 'EXECUTE') then
    v_msg := v_msg || 'service_role CANNOT execute ia_apply_sanction — the IA route would be dead on arrival; ';
  end if;

  if exists (select 1 from councils where context_budget is null) then
    v_msg := v_msg || 'some councils still have a null context_budget after the backfill; ';
  end if;

  if v_msg <> '' then
    raise exception 'D.4 guard: %Refusing to apply.', v_msg;
  end if;

  raise notice 'D.4: agent_audits is admin-only; ia_apply_sanction is service_role-only; councils.context_budget backfilled.';
end $$;

-- The ladder is the sanction rule, so assert it rather than trusting three
-- CASE arms. If these ever compare equal, "strictly more restrictive" silently
-- becomes "any change", and loosening a sanction stops raising.
do $$
begin
  if not (agent_status_rank('active') < agent_status_rank('throttled')
      and agent_status_rank('throttled') < agent_status_rank('suspended')) then
    raise exception
      'D.4 guard: the status ladder is not strictly increasing (active=%, throttled=%, suspended=%). '
      'Sanctions would no longer be one-way.',
      agent_status_rank('active'), agent_status_rank('throttled'), agent_status_rank('suspended');
  end if;

  raise notice 'D.4: status ladder verified strictly increasing (active 0 < throttled 1 < suspended 2).';
end $$;
