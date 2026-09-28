-- ═══════════════════════════════════════════════════════════════════════════
-- VERITAS — 0013_audit_report_ordering.sql   (Post-1.0 Phase D, stage 4, pass 2)
--
-- The model writes the IA report FROM the stored findings. This file makes
-- "from the stored findings" a property of the table rather than of the runner.
--
-- WHY 0011 WAS NOT ENOUGH. 0011's constraints say a report has a timestamp and
-- that the timestamp does not precede the run. A runner that computed findings,
-- asked the model for a report, and then INSERTed the whole row at once would
-- satisfy both — report_at = run_at = now() — while having had the model's output
-- in hand at the moment the findings and severity were written. Nothing would
-- show it. The ordering 0011 describes ("computed BEFORE any model call") was a
-- convention with a constraint that could not tell it had been broken.
--
-- WHAT THIS FILE MAKES TRUE, each as a trigger or constraint, not a comment:
--
--   1. A REPORT IS NEVER BORN WITH ITS FINDINGS. INSERT refuses a row carrying
--      report, report_at or report_error. The only way a report exists is an
--      UPDATE of a row that was already committed without one.
--
--   2. THE RECORD IS FROZEN ON INSERT. findings, severity, public_summary,
--      run_at, agent_name and actions_taken cannot change afterwards — not by
--      the runner, not by the service role (triggers bind service_role; RLS
--      does not). So the model's output, which arrives after the INSERT, has no
--      column it can move except its own.
--
--   3. SEVERITY IS DERIVED FROM FINDINGS, AS A CONSTRAINT. severity must equal
--      the worst grade in `findings`. Exempt: a SANCTION row (findings '[]' and
--      a non-empty actions_taken), which ia_apply_sanction writes with the
--      grade of the action. Nothing else is exempt, so adding a bogus action to
--      a findings row does not buy a hand-picked severity.
--
--   4. THE COMMENTARY IS WRITE-ONCE, AND THE DATABASE STAMPS IT. report (or
--      report_error) may be written exactly once, on a row that has findings to
--      write from. report_at is set by the trigger to now() — the caller cannot
--      choose or backdate it.
--
--   5. A NULL REPORT SAYS WHY. 0011 read NULL as "the model did not run". Once a
--      model is wired, NULL also means "the model ran and returned nothing
--      usable", and those are different facts. report_error records the reason;
--      a row with neither report nor report_error is one whose report stage never
--      completed (the runner died, or it was a --dry-run).
--
-- public_summary IS MECHANICAL, AND POINT 2 IS WHAT KEEPS IT THAT WAY. §D.7 names
-- public_summary, severity and run_at as the only columns ever meant for a
-- public surface. The runner writes public_summary at INSERT, from the findings,
-- before any model call, and it cannot be updated after. If the model wrote it,
-- the site would one day publish unreviewed model prose about a named agent's
-- conduct. Model prose lives in `report`, which is admin-only (§D.7). The
-- decision and the two alternatives rejected: DECISIONS §D.4, "The report".
--
-- DELETE IS NOT GUARDED. verify-agents deletes its probe rows, and the admin
-- policy already confines deletion to admins. Freezing a row is about what it
-- SAYS, not whether it exists; retention is a separate decision.
--
-- Depends on 0011 (agent_audits, audit_severity). Idempotent. agent_audits was
-- empty in the live database when this was written (2026-09-28), so the new
-- constraint is checked against no existing rows — but it is added VALIDATED,
-- so a database where that is not true refuses to apply it rather than
-- quietly grandfathering a row that violates it.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─── 5. Why a report is missing ─────────────────────────────────────────────
alter table agent_audits add column if not exists report_error text;

comment on column agent_audits.report is
  'Model-written commentary on `findings`, admin-only (§D.7). NULL = no report. '
  'report_error says why when the model was tried; neither set = never attempted.';
comment on column agent_audits.report_error is
  'Why `report` is NULL when the report stage ran: model unreachable, or output '
  'rejected as empty/malformed. Mutually exclusive with `report`.';
comment on column agent_audits.public_summary is
  'MECHANICAL, written at INSERT from the findings, frozen afterwards (0013). '
  'The only prose column intended for a public surface (§D.7).';

alter table agent_audits drop constraint if exists agent_audits_report_xor_error;
alter table agent_audits add constraint agent_audits_report_xor_error
  check (report is null or report_error is null);

-- An empty report is not a report. 0011 kept NULL and '' distinct so that "no
-- report" could not be confused with "the model returned nothing"; this closes
-- the other half — '' can no longer be stored at all, so "the model returned
-- nothing" is recorded as report_error, where it says so.
alter table agent_audits drop constraint if exists agent_audits_report_not_blank;
alter table agent_audits add constraint agent_audits_report_not_blank
  check (report is null or btrim(report) <> '');


-- ─── 3. Severity, derived ───────────────────────────────────────────────────
-- The same rule as the runner's `worst()` reduce, and it must stay the same
-- rule: the enum's declaration order (ok < notice < concern < critical) IS the
-- ranking, so max() over the cast values is the worst grade. An empty list is
-- 'ok'. A finding whose severity is not an enum value makes the cast raise,
-- which refuses the row — a grade the schema cannot read is not a grade.
create or replace function audit_findings_severity(p_findings jsonb)
returns audit_severity
language sql immutable as $$
  select case
           when jsonb_typeof(p_findings) <> 'array' then null
           else coalesce(
             (select max((e->>'severity')::audit_severity)
                from jsonb_array_elements(p_findings) e),
             'ok'::audit_severity)
         end;
$$;

revoke execute on function audit_findings_severity(jsonb) from public, anon;
grant  execute on function audit_findings_severity(jsonb) to authenticated, service_role;

alter table agent_audits drop constraint if exists agent_audits_severity_derived;
alter table agent_audits add constraint agent_audits_severity_derived
  check (
    (findings = '[]'::jsonb and jsonb_array_length(actions_taken) > 0)   -- a sanction row
    or severity = audit_findings_severity(findings)
  );


-- ─── 1. A report is never born with its findings ────────────────────────────
create or replace function agent_audits_guard_insert() returns trigger
language plpgsql as $$
begin
  if new.report is not null or new.report_at is not null or new.report_error is not null then
    raise exception
      'agent_audits: a row is INSERTed without a report and the report UPDATEs it (0013). '
      'An INSERT carrying report/report_at/report_error means the report existed '
      'before the findings were stored — the ordering §D.4 forbids.'
      using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists agent_audits_guard_insert on agent_audits;
create trigger agent_audits_guard_insert
  before insert on agent_audits
  for each row execute function agent_audits_guard_insert();


-- ─── 2 + 4. The record is frozen; the commentary is write-once ──────────────
create or replace function agent_audits_guard_update() returns trigger
language plpgsql as $$
begin
  -- The record. Every column the report could be tempted to agree with.
  if new.id             is distinct from old.id
  or new.run_at         is distinct from old.run_at
  or new.findings       is distinct from old.findings
  or new.severity       is distinct from old.severity
  or new.public_summary is distinct from old.public_summary
  or new.actions_taken  is distinct from old.actions_taken
  or new.agent_name     is distinct from old.agent_name then
    raise exception
      'agent_audits: findings, severity, public_summary, run_at, agent_name and '
      'actions_taken are frozen at INSERT (0013). Only the report may be added.'
      using errcode = '23514';
  end if;

  -- agent_id may only go to NULL: that is 0011's `on delete set null`, which
  -- arrives here as an UPDATE, and must keep working so that deleting an agent
  -- does not erase its audit trail. Re-pointing an audit at another agent is not
  -- something any path should be able to do.
  if new.agent_id is distinct from old.agent_id and new.agent_id is not null then
    raise exception 'agent_audits: agent_id may only be cleared (on delete set null), never re-pointed.'
      using errcode = '23514';
  end if;

  -- The commentary. Compared as a whole so that an UPDATE which leaves it alone
  -- (the FK's set-null) passes straight through.
  if (new.report, new.report_at, new.report_error)
       is distinct from (old.report, old.report_at, old.report_error) then

    if old.report is not null or old.report_error is not null then
      raise exception
        'agent_audits: the report stage has already recorded its outcome on this row; it is write-once (0013).'
        using errcode = '23514';
    end if;

    if jsonb_array_length(old.findings) = 0 then
      raise exception
        'agent_audits: this row has no findings, so there is nothing to write a report FROM (sanction rows carry their reason in actions_taken).'
        using errcode = '23514';
    end if;

    -- The database says when the report was written. A caller-supplied value is
    -- overwritten, not trusted, so report_at cannot be backdated to look as if it
    -- came before anything.
    new.report_at := case when new.report is not null then now() else null end;
  end if;

  return new;
end $$;

drop trigger if exists agent_audits_guard_update on agent_audits;
create trigger agent_audits_guard_update
  before update on agent_audits
  for each row execute function agent_audits_guard_update();

-- Trigger functions cannot be called outside a trigger, so EXECUTE on them is
-- not a capability. Revoked anyway, so that nothing in §11's inventory of
-- PUBLIC-executable functions grows by two for no reason.
revoke execute on function agent_audits_guard_insert() from public, anon, authenticated;
revoke execute on function agent_audits_guard_update() from public, anon, authenticated;


-- ─── Verification — each promise above, exercised and rolled back ───────────
--
-- Every write below happens inside a block that ends by raising a sentinel, so
-- the whole sub-transaction rolls back and no probe row survives. Each expected
-- refusal is caught by SQLSTATE; anything else — including an expected refusal
-- that did NOT happen — is collected into v_msg and fails the migration.
do $$
declare
  v_msg      text := '';
  v_id       uuid;
  v_row      agent_audits;
  v_findings jsonb := '[{"check":1,"severity":"ok"},{"check":2,"severity":"notice"}]';
begin
  begin
    -- (1) INSERT carrying a report → refused.
    begin
      insert into agent_audits (agent_name, findings, severity, report, report_at)
      values ('0013-probe', v_findings, 'notice', 'born with its findings', now());
      v_msg := v_msg || 'INSERT with a report was ACCEPTED; ';
    exception when check_violation then null;
    end;

    -- (3) INSERT with a hand-picked severity → refused.
    begin
      insert into agent_audits (agent_name, findings, severity)
      values ('0013-probe', v_findings, 'critical');
      v_msg := v_msg || 'INSERT with severity critical over notice-grade findings was ACCEPTED; ';
    exception when check_violation then null;
    end;

    -- (3) …and the same findings with the derived severity → accepted. The
    --     permitted case, asserted, so a constraint that refused everything
    --     could not pass this block.
    insert into agent_audits (agent_name, findings, severity, public_summary)
    values ('0013-probe', v_findings, 'notice', 'probe')
    returning id into v_id;

    -- (2) findings, severity, public_summary frozen.
    begin
      update agent_audits set findings = '[]' where id = v_id;
      v_msg := v_msg || 'UPDATE of findings was ACCEPTED; ';
    exception when check_violation then null;
    end;
    begin
      update agent_audits set severity = 'ok' where id = v_id;
      v_msg := v_msg || 'UPDATE of severity was ACCEPTED; ';
    exception when check_violation then null;
    end;
    begin
      update agent_audits set public_summary = 'model prose' where id = v_id;
      v_msg := v_msg || 'UPDATE of public_summary was ACCEPTED; ';
    exception when check_violation then null;
    end;

    -- (4) the report, once, with a caller-supplied report_at that is ignored.
    update agent_audits
       set report = 'written from the findings', report_at = '2000-01-01'
     where id = v_id
    returning * into v_row;
    if v_row.report_at is distinct from now() then
      v_msg := v_msg || format('report_at was not stamped by the database (got %s); ', v_row.report_at);
    end if;
    if v_row.severity <> 'notice' then
      v_msg := v_msg || 'severity moved when the report was written; ';
    end if;

    -- (4) …and not twice.
    begin
      update agent_audits set report = 'a second opinion' where id = v_id;
      v_msg := v_msg || 'a SECOND report write was ACCEPTED; ';
    exception when check_violation then null;
    end;

    raise exception using errcode = 'P0001', message = '0013-rollback-sentinel';
  exception
    when others then
      if sqlerrm <> '0013-rollback-sentinel' then
        v_msg := v_msg || format('unexpected error %s: %s; ', sqlstate, sqlerrm);
      end if;
  end;

  if exists (select 1 from agent_audits where agent_name = '0013-probe') then
    v_msg := v_msg || 'a probe row survived the rollback; ';
  end if;

  if v_msg <> '' then
    raise exception 'D.4 report-ordering guard: %Refusing to apply.', v_msg;
  end if;

  raise notice '0013: report is write-once and post-INSERT, the record is frozen, severity is derived — each exercised and rolled back.';
end $$;
