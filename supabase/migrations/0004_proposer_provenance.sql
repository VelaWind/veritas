-- ═══════════════════════════════════════════════════════════════════════════
-- VERITAS — 0004_proposer_provenance.sql   (Phase A follow-up, prep for Phase B)
--
-- Provenance fix: when an EDIT suggestion is approved, the public timeline event
-- must credit the ORIGINAL proposer (human or agent), not the approving admin.
--
-- Mechanism: apply_suggestion() publishes the proposer's identity into three
-- transaction-local GUCs before it writes; log_hypothesis_update() reads them.
-- Transaction-local (set_config(..., is_local => true)) means they auto-reset at
-- commit/rollback and never leak across PostgREST requests on a pooled
-- connection. A DIRECT admin edit sets no GUC, so the function falls back to
-- auth.uid()/'human'/null — byte-for-byte the prior behaviour. Creates were
-- already credited correctly (log_hypothesis_insert uses created_by), so only
-- the update trigger and apply_suggestion change here.
--
-- Idempotent: both objects are CREATE OR REPLACE. Re-runnable on the live DB.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. log_hypothesis_update(): honour the proposer-attribution override ─────

create or replace function log_hypothesis_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  -- Override actor when set by apply_suggestion(); otherwise the JWT caller.
  v_actor_id   uuid       := coalesce(nullif(current_setting('veritas.actor_id', true), '')::uuid, auth.uid());
  v_actor_type actor_type := coalesce(nullif(current_setting('veritas.actor_type', true), '')::actor_type, 'human');
  v_agent_name text       := nullif(current_setting('veritas.agent_name', true), '');
begin
  if new.status is distinct from old.status or new.state is distinct from old.state then
    insert into timeline_events (event_type, node_type, node_id, summary, payload, actor_id, actor_type, agent_name)
    values ('hypothesis_status_changed', 'hypothesis', new.id,
            format('"%s": %s/%s → %s/%s', new.title, old.status, old.state, new.status, new.state),
            jsonb_build_object('old_status', old.status, 'new_status', new.status,
                               'old_state', old.state, 'new_state', new.state),
            v_actor_id, v_actor_type, v_agent_name);
  elsif (new.title, new.description, new.assumptions, new.open_questions,
         new.falsification_criteria, new.domain_id, new.question_id)
        is distinct from
        (old.title, old.description, old.assumptions, old.open_questions,
         old.falsification_criteria, old.domain_id, old.question_id) then
    -- Confidence-only changes are logged by trg_confidence; popularity ticks
    -- are deliberately silent.
    insert into timeline_events (event_type, node_type, node_id, summary, actor_id, actor_type, agent_name)
    values ('hypothesis_updated', 'hypothesis', new.id,
            format('Hypothesis revised: "%s"', new.title), v_actor_id, v_actor_type, v_agent_name);
  end if;
  return new;
end $$;

-- ─── 2. apply_suggestion(): publish proposer identity for the update trigger ──
-- Identical to 0003 except for the three set_config() calls before the branch.

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

  -- Credit any audit events fired by the writes below to the proposer, not the
  -- approving admin. Transaction-local; auto-reset at commit. Creates already
  -- carry the proposer via created_by/actor_type/agent_name columns.
  perform set_config('veritas.actor_id', coalesce(s.proposed_by::text, ''), true);
  perform set_config('veritas.actor_type', s.actor_type::text, true);
  perform set_config('veritas.agent_name', coalesce(s.agent_name, ''), true);

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
