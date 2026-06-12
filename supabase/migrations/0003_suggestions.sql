-- ═══════════════════════════════════════════════════════════════════════════
-- VERITAS — 0003_suggestions.sql   (Post-1.0 Phase A: researcher suggestion queue)
--
-- Adds a review queue so 'researcher'-role users (and, in Phase B, 'agent'
-- actors) can PROPOSE hypotheses/evidence and edits without ever writing
-- directly to public knowledge. Admins approve or reject. Approval is applied
-- by ONE security-definer function so it is atomic and runs through every
-- existing epistemic constraint and audit trigger from 0001 — this migration
-- adds NO new write path to the knowledge tables and weakens no existing RLS
-- policy, constraint, or auth gate (see DECISIONS.md "Phase A").
--
-- Idempotent where practical so it is safe to re-run on the live DB.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Enums ───────────────────────────────────────────────────────────────────

do $$ begin
  create type suggestion_operation as enum ('create', 'edit');
exception when duplicate_object then null; end $$;

do $$ begin
  create type suggestion_status as enum ('pending', 'approved', 'rejected', 'withdrawn');
exception when duplicate_object then null; end $$;

-- ─── Role helper: researcher OR admin (mirrors the null-safe is_admin()) ──────
-- A contributor may propose into the queue; only is_admin() may approve/reject.
-- security definer + stable + exists() => never null, safe inside RLS.

create or replace function is_contributor() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and exists (
       select 1 from profiles
       where id = auth.uid() and role in ('researcher', 'admin')
     );
$$;

-- ─── Table ───────────────────────────────────────────────────────────────────
-- target_type reuses node_type (everything is a node) but is constrained to the
-- two entities researchers may propose in Phase A. payload mirrors the exact
-- shape the admin create/edit Zod schemas already produce (one shared contract).

create table if not exists suggestions (
  id            uuid primary key default gen_random_uuid(),
  target_type   node_type not null,
  operation     suggestion_operation not null,
  target_id     uuid,                              -- null for create; the edited node for edit
  payload       jsonb not null default '{}',
  rationale     text not null default '',          -- proposer's note to the reviewer
  status        suggestion_status not null default 'pending',
  proposed_by   uuid references profiles(id),
  actor_type    actor_type not null default 'human',  -- 'agent' reuses this table in Phase B
  agent_name    text,
  reviewed_by   uuid references profiles(id),
  review_notes  text not null default '',
  reviewed_at   timestamptz,
  applied_id    uuid,                              -- the created/edited node id, once approved
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint suggestions_target_kind check (target_type in ('hypothesis', 'evidence')),
  constraint suggestions_edit_has_target check (operation = 'create' or target_id is not null)
);

create index if not exists idx_suggestions_status   on suggestions (status, created_at desc);
create index if not exists idx_suggestions_proposer on suggestions (proposed_by, created_at desc);

create trigger trg_touch_suggestions before update on suggestions
  for each row execute function touch_updated_at();

-- ─── Row-Level Security ──────────────────────────────────────────────────────
-- Public users: no access at all (suggestions are not public knowledge until
-- approved and applied, at which point the normal public tables carry them).

alter table suggestions enable row level security;

-- Contributors propose, attributed to themselves, pending only.
drop policy if exists "contributor insert own" on suggestions;
create policy "contributor insert own" on suggestions
  for insert
  with check (proposed_by = auth.uid() and status = 'pending' and is_contributor());

-- Proposer reads own; admins read all.
drop policy if exists "read own or admin" on suggestions;
create policy "read own or admin" on suggestions
  for select
  using (proposed_by = auth.uid() or is_admin());

-- Proposer may revise or withdraw their OWN still-pending suggestion, but the
-- with-check forbids moving it to approved/rejected — they cannot self-approve.
drop policy if exists "proposer update own pending" on suggestions;
create policy "proposer update own pending" on suggestions
  for update
  using (proposed_by = auth.uid() and status = 'pending')
  with check (proposed_by = auth.uid() and status in ('pending', 'withdrawn'));

-- Admins review (reject / manual close). Approval is applied by the
-- security-definer apply_suggestion() below, which self-guards on is_admin().
drop policy if exists "admin manage" on suggestions;
create policy "admin manage" on suggestions
  for all
  using (is_admin()) with check (is_admin());

-- ─── Approval: ONE atomic, audited application path ──────────────────────────
-- Re-reads the locked suggestion, applies it by inserting/updating the real
-- node, and stamps the review fields — all in one transaction. The insert/
-- update fires EXISTING triggers (timeline_events, confidence_history,
-- touch_updated_at) and is checked by EXISTING constraints (epistemics_
-- consistent, enforce_active_rationale). Attribution: created nodes carry the
-- proposer as created_by/actor_type/agent_name (so the lifecycle trigger
-- credits the proposer); reviewed_by records the approving admin.
--
-- security definer bypasses RLS on the target tables, so the function self-
-- guards with is_admin(); the epistemic CHECK constraints and audit triggers
-- are NOT RLS and still fire, so no guarantee is lost.

create or replace function apply_suggestion(p_suggestion_id uuid, p_notes text default '')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s         suggestions;
  p         jsonb;
  v_applied uuid;
  v_source  uuid;
begin
  if not is_admin() then
    raise exception 'Only admins may approve suggestions.' using errcode = '42501';
  end if;

  select * into s from suggestions where id = p_suggestion_id for update;
  if not found then
    raise exception 'Suggestion % not found.', p_suggestion_id;
  end if;
  if s.status <> 'pending' then
    raise exception 'Suggestion is not pending (current status: %).', s.status;
  end if;

  p := s.payload;

  if s.target_type = 'hypothesis' and s.operation = 'create' then
    insert into hypotheses (
      slug, domain_id, question_id, title, description, status, state,
      confidence, confidence_rationale, assumptions, open_questions,
      falsification_criteria, created_by, actor_type, agent_name)
    values (
      p->>'slug', (p->>'domain_id')::uuid, nullif(p->>'question_id', '')::uuid,
      p->>'title', p->>'description',
      (p->>'status')::epistemic_status, (p->>'state')::hypothesis_state,
      coalesce((p->>'confidence')::int, 0), coalesce(p->>'confidence_rationale', ''),
      coalesce(p->'assumptions', '[]'::jsonb), coalesce(p->'open_questions', '[]'::jsonb),
      coalesce(p->>'falsification_criteria', ''),
      s.proposed_by, s.actor_type, s.agent_name)
    returning id into v_applied;

  elsif s.target_type = 'hypothesis' and s.operation = 'edit' then
    -- Confidence is deliberately NOT editable via the queue (admins own it
    -- through the dedicated confidence editor); mirrors the admin edit form.
    update hypotheses set
      slug                   = coalesce(p->>'slug', slug),
      domain_id              = coalesce((p->>'domain_id')::uuid, domain_id),
      question_id            = case when p ? 'question_id'
                                    then nullif(p->>'question_id', '')::uuid else question_id end,
      title                  = coalesce(p->>'title', title),
      description            = coalesce(p->>'description', description),
      status                 = coalesce((p->>'status')::epistemic_status, status),
      state                  = coalesce((p->>'state')::hypothesis_state, state),
      assumptions            = coalesce(p->'assumptions', assumptions),
      open_questions         = coalesce(p->'open_questions', open_questions),
      falsification_criteria = coalesce(p->>'falsification_criteria', falsification_criteria)
    where id = s.target_id
    returning id into v_applied;
    if v_applied is null then
      raise exception 'Target hypothesis % not found.', s.target_id;
    end if;

  elsif s.target_type = 'evidence' and s.operation = 'create' then
    if p ? 'new_source' and jsonb_typeof(p->'new_source') = 'object' then
      insert into sources (title, authors, url, doi, source_type, year, reliability)
      values (
        p->'new_source'->>'title', p->'new_source'->>'authors', p->'new_source'->>'url',
        p->'new_source'->>'doi',
        coalesce((p->'new_source'->>'source_type')::source_type, 'other'),
        nullif(p->'new_source'->>'year', '')::int,
        coalesce((p->'new_source'->>'reliability')::int, 50))
      returning id into v_source;
    else
      v_source := nullif(p->>'source_id', '')::uuid;
    end if;
    insert into evidence (
      slug, title, summary, strength, domain_id, source_id,
      created_by, actor_type, agent_name)
    values (
      p->>'slug', p->>'title', p->>'summary', coalesce((p->>'strength')::int, 50),
      nullif(p->>'domain_id', '')::uuid, v_source,
      s.proposed_by, s.actor_type, s.agent_name)
    returning id into v_applied;

  elsif s.target_type = 'evidence' and s.operation = 'edit' then
    if p ? 'new_source' and jsonb_typeof(p->'new_source') = 'object' then
      insert into sources (title, authors, url, doi, source_type, year, reliability)
      values (
        p->'new_source'->>'title', p->'new_source'->>'authors', p->'new_source'->>'url',
        p->'new_source'->>'doi',
        coalesce((p->'new_source'->>'source_type')::source_type, 'other'),
        nullif(p->'new_source'->>'year', '')::int,
        coalesce((p->'new_source'->>'reliability')::int, 50))
      returning id into v_source;
    else
      v_source := null;
    end if;
    update evidence set
      slug      = coalesce(p->>'slug', slug),
      title     = coalesce(p->>'title', title),
      summary   = coalesce(p->>'summary', summary),
      strength  = coalesce((p->>'strength')::int, strength),
      domain_id = case when p ? 'domain_id' then nullif(p->>'domain_id', '')::uuid else domain_id end,
      source_id = coalesce(v_source,
                           case when p ? 'source_id' then nullif(p->>'source_id', '')::uuid else source_id end)
    where id = s.target_id
    returning id into v_applied;
    if v_applied is null then
      raise exception 'Target evidence % not found.', s.target_id;
    end if;

  else
    raise exception 'Unsupported suggestion (% / %).', s.target_type, s.operation;
  end if;

  update suggestions set
    status       = 'approved',
    reviewed_by  = auth.uid(),
    reviewed_at  = now(),
    review_notes = coalesce(p_notes, ''),
    applied_id   = v_applied
  where id = s.id;

  return jsonb_build_object(
    'applied_id', v_applied,
    'target_type', s.target_type,
    'operation', s.operation);
end $$;

-- ─── Grants ──────────────────────────────────────────────────────────────────
-- Table: anon has NO access (no grant). authenticated gets DML (RLS gates it).
-- The 0001 ALTER DEFAULT PRIVILEGES already grants authenticated/service_role
-- on future tables and revokes nothing from anon, so we revoke anon explicitly.

grant select, insert, update, delete on suggestions to authenticated;
grant all on suggestions to service_role;
revoke all on suggestions from anon;

-- apply_suggestion: admins (authenticated, self-guarded) and service_role only.
revoke execute on function apply_suggestion(uuid, text) from public, anon;
grant execute on function apply_suggestion(uuid, text) to authenticated, service_role;
grant execute on function is_contributor() to anon, authenticated, service_role;
