-- ═══════════════════════════════════════════════════════════════════════════
-- VERITAS — 0001_core.sql
-- Implements §2 of veritas-architecture-v1.md. The database enforces
-- epistemics: status/confidence consistency, mandatory rationales, and
-- append-only history live HERE, not in application code (§10 invariants).
-- Deviations from the spec text are minimal, necessary, and marked [spec-fix];
-- see DECISIONS.md for rationale.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── §2.1 Enums ──────────────────────────────────────────────────────────────

create type epistemic_status as enum (
  'established',      -- Established Knowledge
  'strong_evidence',  -- Strong Evidence
  'plausible',        -- Plausible Hypothesis
  'speculation',      -- Speculation
  'unknown'           -- Unknown
);

create type hypothesis_state as enum ('draft', 'active', 'contested', 'superseded', 'retired');
create type evidence_relation as enum ('supports', 'opposes', 'neutral');
create type source_type as enum (
  'peer_reviewed', 'preprint', 'book', 'dataset',
  'experiment', 'observation', 'simulation_result',
  'philosophical_argument', 'mathematical_proof', 'other'
);
create type edge_type as enum ('supports', 'contradicts', 'related_to', 'derived_from');
create type node_type as enum ('question', 'hypothesis', 'evidence', 'domain', 'simulation');
create type actor_type as enum ('human', 'agent', 'system');
create type user_role as enum ('public', 'researcher', 'admin');
create type timeline_event_type as enum (
  'hypothesis_created', 'hypothesis_updated', 'hypothesis_status_changed',
  'evidence_added', 'evidence_linked', 'evidence_unlinked',
  'confidence_changed', 'contradiction_detected', 'contradiction_resolved',
  'question_added', 'simulation_completed', 'note_published'
);

-- ─── §2.2 Identity & Roles ───────────────────────────────────────────────────

-- Mirrors auth.users; created by trigger on signup.
create table profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role         user_role not null default 'public',
  created_at   timestamptz not null default now()
);

create function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1)));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Helper used by every RLS policy.
create function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

-- profiles.role may only be changed by admins. auth.uid() is null when the
-- change comes from the SQL editor or the service role — that path is allowed
-- so the documented first-admin provisioning one-liner works.
create function guard_role_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role
     and auth.uid() is not null
     and not is_admin() then
    raise exception 'Only admins may change roles.';
  end if;
  return new;
end $$;

create trigger trg_guard_role before update on profiles
  for each row execute function guard_role_change();

-- ─── §2.3 Core Knowledge Tables ──────────────────────────────────────────────

create table domains (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,            -- 'physics', 'consciousness'…
  name        text not null,
  overview    text not null default '',
  icon        text,                            -- lucide icon name
  sort_order  int not null default 0,
  research_status text not null default '',    -- prose summary of state of field
  created_at  timestamptz not null default now()
);

create table questions (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique not null,
  domain_id     uuid not null references domains(id),
  title         text not null,                 -- "Why is there something rather than nothing?"
  description   text not null default '',
  importance    int not null default 50 check (importance between 0 and 100),
  status        epistemic_status not null default 'unknown',
  current_explanations text not null default '',  -- markdown
  research_progress    text not null default '',  -- markdown
  created_by    uuid references profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table hypotheses (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  domain_id   uuid not null references domains(id),
  question_id uuid references questions(id),     -- optional parent question
  title       text not null,
  description text not null,                     -- markdown
  status      epistemic_status not null default 'speculation',
  state       hypothesis_state not null default 'draft',
  confidence  int not null default 0 check (confidence between 0 and 100),
  confidence_rationale text not null default '', -- required non-empty before state='active' (trigger below)
  assumptions jsonb not null default '[]',       -- [{text, justified: bool, notes}]
  open_questions jsonb not null default '[]',    -- [{text}]
  falsification_criteria text not null default '',
  popularity  int not null default 0,            -- view counter, denormalized
  created_by  uuid references profiles(id),
  actor_type  actor_type not null default 'human',
  agent_name  text,                              -- null for humans
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Epistemic guard: speculation can never carry high confidence,
-- and 'established' requires very strong confidence. (§10 invariant 1)
alter table hypotheses add constraint epistemics_consistent check (
  (status = 'speculation'     and confidence <= 40) or
  (status = 'plausible'       and confidence between 21 and 60) or
  (status = 'strong_evidence' and confidence between 61 and 80) or
  (status = 'established'     and confidence >= 81) or
  (status = 'unknown'         and confidence <= 20)
);

create table sources (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  authors     text,
  url         text,
  doi         text,
  source_type source_type not null default 'other',
  year        int,
  reliability int not null default 50 check (reliability between 0 and 100),
  created_at  timestamptz not null default now()
);

create table evidence (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  title       text not null,
  summary     text not null,                    -- markdown
  source_id   uuid references sources(id),
  strength    int not null default 50 check (strength between 0 and 100),
  domain_id   uuid references domains(id),
  created_by  uuid references profiles(id),
  actor_type  actor_type not null default 'human',
  agent_name  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- The epistemic core: evidence ↔ hypothesis links.
create table hypothesis_evidence (
  hypothesis_id uuid not null references hypotheses(id) on delete cascade,
  evidence_id   uuid not null references evidence(id) on delete cascade,
  relation      evidence_relation not null,
  weight        int not null default 50 check (weight between 0 and 100),
  notes         text not null default '',
  created_by    uuid references profiles(id),
  created_at    timestamptz not null default now(),
  primary key (hypothesis_id, evidence_id)
);

-- ─── §2.4 Graph, Contradictions, History ─────────────────────────────────────

-- Generic typed edges between any two nodes.
create table graph_edges (
  id          uuid primary key default gen_random_uuid(),
  from_type   node_type not null,
  from_id     uuid not null,
  to_type     node_type not null,
  to_id       uuid not null,
  edge        edge_type not null,
  created_by  uuid references profiles(id),
  created_at  timestamptz not null default now(),
  unique (from_type, from_id, to_type, to_id, edge)
);

create table contradictions (
  id            uuid primary key default gen_random_uuid(),
  hypothesis_a  uuid not null references hypotheses(id) on delete cascade,
  hypothesis_b  uuid not null references hypotheses(id) on delete cascade,
  kind          text not null default 'logical',  -- 'logical' | 'evidential' | 'assumption'
  explanation   text not null,
  detected_by   actor_type not null default 'system',
  resolved      boolean not null default false,
  resolution_notes text not null default '',
  created_at    timestamptz not null default now(),
  check (hypothesis_a <> hypothesis_b),
  -- [spec-fix] §2.7 scan_contradictions() depends on `on conflict do nothing`;
  -- without a unique constraint that clause never fires and every scan
  -- duplicates rows. This makes the scan idempotent as intended.
  unique (hypothesis_a, hypothesis_b, kind)
);

-- Immutable audit trail → powers Timeline of Understanding.
create table timeline_events (
  id          bigint generated always as identity primary key,
  event_type  timeline_event_type not null,
  node_type   node_type not null,
  node_id     uuid not null,
  summary     text not null,                    -- human-readable line for the timeline
  payload     jsonb not null default '{}',      -- diff / context
  actor_id    uuid references profiles(id),
  actor_type  actor_type not null default 'human',
  agent_name  text,
  created_at  timestamptz not null default now()
);
-- No UPDATE/DELETE policies are ever created for this table. (§10 invariant 3)

create table confidence_history (
  id            bigint generated always as identity primary key,
  hypothesis_id uuid not null references hypotheses(id) on delete cascade,
  old_value     int,
  new_value     int not null,
  rationale     text not null,
  actor_id      uuid references profiles(id),
  created_at    timestamptz not null default now()
);

-- ─── §2.5 Simulations & Research Notes ───────────────────────────────────────

create table simulations (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  category    text not null check (category in
    ('artificial_ecosystems','agent_intelligence','civilizations',
     'universe_simulations','consciousness_experiments')),
  title       text not null,
  description text not null default '',
  parameters  jsonb not null default '{}',
  status      text not null default 'planned'
              check (status in ('planned','running','completed','archived')),
  created_by  uuid references profiles(id),
  created_at  timestamptz not null default now()
);

create table simulation_runs (
  id            uuid primary key default gen_random_uuid(),
  simulation_id uuid not null references simulations(id) on delete cascade,
  parameters    jsonb not null default '{}',
  results       jsonb not null default '{}',
  metrics       jsonb not null default '{}',   -- chartable series for Recharts
  artifact_path text,                          -- Supabase Storage path
  started_at    timestamptz,
  finished_at   timestamptz,
  created_at    timestamptz not null default now()
);

create table research_notes (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  title       text not null,
  body        text not null,                   -- markdown
  published   boolean not null default false,
  author_id   uuid references profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ─── Indexes (FK lookups & hot paths) ────────────────────────────────────────

create index idx_questions_domain        on questions (domain_id);
create index idx_hypotheses_domain       on hypotheses (domain_id);
create index idx_hypotheses_question     on hypotheses (question_id);
create index idx_evidence_domain         on evidence (domain_id);
create index idx_evidence_source         on evidence (source_id);
create index idx_he_evidence             on hypothesis_evidence (evidence_id);
create index idx_graph_edges_from        on graph_edges (from_type, from_id);
create index idx_graph_edges_to          on graph_edges (to_type, to_id);
create index idx_contradictions_a        on contradictions (hypothesis_a);
create index idx_contradictions_b        on contradictions (hypothesis_b);
create index idx_timeline_created        on timeline_events (created_at desc, id desc);
create index idx_timeline_node           on timeline_events (node_type, node_id);
create index idx_confidence_history_hyp  on confidence_history (hypothesis_id, created_at);
create index idx_simulation_runs_sim     on simulation_runs (simulation_id);
create index idx_simulations_category    on simulations (category);

-- ─── §2.6 Triggers: History Is a Byproduct of Writes ─────────────────────────

create function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create trigger trg_touch_hypotheses before update on hypotheses
  for each row execute function touch_updated_at();
create trigger trg_touch_questions before update on questions
  for each row execute function touch_updated_at();
create trigger trg_touch_evidence before update on evidence
  for each row execute function touch_updated_at();
create trigger trg_touch_research_notes before update on research_notes
  for each row execute function touch_updated_at();

-- §2.3 comment: confidence_rationale is REQUIRED to be non-empty before
-- state='active'. [spec-fix] The spec references this trigger but omits its
-- definition; implemented here.
create function enforce_active_rationale() returns trigger
language plpgsql as $$
begin
  if new.state = 'active' and new.confidence_rationale = '' then
    raise exception 'Hypotheses cannot be active without a confidence rationale.';
  end if;
  return new;
end $$;

create trigger trg_active_rationale before insert or update on hypotheses
  for each row execute function enforce_active_rationale();

-- Confidence changes are recorded automatically and require a rationale.
-- (§10 invariant 2)
create function log_confidence_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.confidence is distinct from old.confidence then
    if new.confidence_rationale = '' then
      raise exception 'Confidence changes require a non-empty rationale.';
    end if;
    insert into confidence_history (hypothesis_id, old_value, new_value, rationale, actor_id)
    values (new.id, old.confidence, new.confidence, new.confidence_rationale, auth.uid());

    insert into timeline_events (event_type, node_type, node_id, summary, payload, actor_id)
    values ('confidence_changed', 'hypothesis', new.id,
            format('Confidence for "%s": %s → %s', new.title, old.confidence, new.confidence),
            jsonb_build_object('old', old.confidence, 'new', new.confidence),
            auth.uid());
  end if;
  return new;
end $$;

-- [spec-fix] §2.6 writes `create trigger trg_confidence on hypotheses before
-- update on hypotheses…`, naming the table twice — a syntax error. Intent
-- preserved verbatim below.
create trigger trg_confidence before update on hypotheses
  for each row execute function log_confidence_change();

-- Linking evidence emits timeline events + graph edges automatically.
create function on_evidence_linked() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into graph_edges (from_type, from_id, to_type, to_id, edge, created_by)
  values ('evidence', new.evidence_id, 'hypothesis', new.hypothesis_id,
          case new.relation when 'supports' then 'supports'::edge_type
                            when 'opposes'  then 'contradicts'::edge_type
                            else 'related_to'::edge_type end,
          new.created_by)
  on conflict do nothing;

  insert into timeline_events (event_type, node_type, node_id, summary, actor_id)
  values ('evidence_linked', 'hypothesis', new.hypothesis_id,
          format('Evidence linked (%s)', new.relation), new.created_by);
  return new;
end $$;

create trigger trg_evidence_linked after insert on hypothesis_evidence
  for each row execute function on_evidence_linked();

-- Unlinking removes the derived graph edge and leaves an audit event.
-- [spec-fix] §2.1 defines 'evidence_unlinked' but no trigger emits it; without
-- edge cleanup the graph would keep stale supports/contradicts edges forever.
create function on_evidence_unlinked() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from graph_edges
  where from_type = 'evidence' and from_id = old.evidence_id
    and to_type = 'hypothesis' and to_id = old.hypothesis_id;

  insert into timeline_events (event_type, node_type, node_id, summary, actor_id)
  values ('evidence_unlinked', 'hypothesis', old.hypothesis_id,
          format('Evidence unlinked (%s)', old.relation), auth.uid());
  return old;
end $$;

create trigger trg_evidence_unlinked after delete on hypothesis_evidence
  for each row execute function on_evidence_unlinked();

-- Lifecycle events. [spec-fix] §2.1's timeline_event_type enumerates created/
-- updated/status-change/added/published/detected/resolved/completed events and
-- §1.2-2 requires every change to emit history from the write path, but §2.6
-- only shows triggers for confidence and linking. The remainder follow.

create function log_hypothesis_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into timeline_events (event_type, node_type, node_id, summary, payload, actor_id, actor_type, agent_name)
  values ('hypothesis_created', 'hypothesis', new.id,
          format('Hypothesis proposed: "%s"', new.title),
          jsonb_build_object('status', new.status, 'state', new.state, 'confidence', new.confidence),
          coalesce(new.created_by, auth.uid()), new.actor_type, new.agent_name);
  return new;
end $$;

create trigger trg_hypothesis_insert after insert on hypotheses
  for each row execute function log_hypothesis_insert();

create function log_hypothesis_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status or new.state is distinct from old.state then
    insert into timeline_events (event_type, node_type, node_id, summary, payload, actor_id)
    values ('hypothesis_status_changed', 'hypothesis', new.id,
            format('"%s": %s/%s → %s/%s', new.title, old.status, old.state, new.status, new.state),
            jsonb_build_object('old_status', old.status, 'new_status', new.status,
                               'old_state', old.state, 'new_state', new.state),
            auth.uid());
  elsif (new.title, new.description, new.assumptions, new.open_questions,
         new.falsification_criteria, new.domain_id, new.question_id)
        is distinct from
        (old.title, old.description, old.assumptions, old.open_questions,
         old.falsification_criteria, old.domain_id, old.question_id) then
    -- Confidence-only changes are logged by trg_confidence; popularity ticks
    -- are deliberately silent.
    insert into timeline_events (event_type, node_type, node_id, summary, actor_id)
    values ('hypothesis_updated', 'hypothesis', new.id,
            format('Hypothesis revised: "%s"', new.title), auth.uid());
  end if;
  return new;
end $$;

create trigger trg_hypothesis_update after update on hypotheses
  for each row execute function log_hypothesis_update();

create function log_evidence_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into timeline_events (event_type, node_type, node_id, summary, payload, actor_id, actor_type, agent_name)
  values ('evidence_added', 'evidence', new.id,
          format('Evidence added: "%s"', new.title),
          jsonb_build_object('strength', new.strength),
          coalesce(new.created_by, auth.uid()), new.actor_type, new.agent_name);
  return new;
end $$;

create trigger trg_evidence_insert after insert on evidence
  for each row execute function log_evidence_insert();

create function log_question_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into timeline_events (event_type, node_type, node_id, summary, payload, actor_id)
  values ('question_added', 'question', new.id,
          format('Question raised: "%s"', new.title),
          jsonb_build_object('importance', new.importance),
          coalesce(new.created_by, auth.uid()));
  return new;
end $$;

create trigger trg_question_insert after insert on questions
  for each row execute function log_question_insert();

-- [spec-fix] node_type has no 'note' member and the enum is part of the spec
-- contract; research-note events are recorded with node_type='hypothesis' as
-- the closest narrative type, and the UI resolves the link via
-- payload->>'kind' = 'research_note' + payload->>'slug'.
create function log_note_published() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.published and (tg_op = 'INSERT' or not old.published) then
    insert into timeline_events (event_type, node_type, node_id, summary, payload, actor_id)
    values ('note_published', 'hypothesis', new.id,
            format('Research note published: "%s"', new.title),
            jsonb_build_object('slug', new.slug, 'kind', 'research_note'),
            coalesce(new.author_id, auth.uid()));
  end if;
  return new;
end $$;

create trigger trg_note_published after insert or update on research_notes
  for each row execute function log_note_published();

create function log_contradiction_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into timeline_events (event_type, node_type, node_id, summary, payload, actor_id, actor_type)
    values ('contradiction_detected', 'hypothesis', new.hypothesis_a,
            format('Contradiction detected (%s)', new.kind),
            jsonb_build_object('contradiction_id', new.id, 'hypothesis_b', new.hypothesis_b),
            auth.uid(), new.detected_by);
  elsif tg_op = 'UPDATE' and new.resolved and not old.resolved then
    insert into timeline_events (event_type, node_type, node_id, summary, payload, actor_id)
    values ('contradiction_resolved', 'hypothesis', new.hypothesis_a,
            format('Contradiction resolved (%s)', new.kind),
            jsonb_build_object('contradiction_id', new.id, 'hypothesis_b', new.hypothesis_b,
                               'resolution', new.resolution_notes),
            auth.uid());
  end if;
  return new;
end $$;

create trigger trg_contradiction_change after insert or update on contradictions
  for each row execute function log_contradiction_change();

create function log_simulation_completed() returns trigger
language plpgsql security definer set search_path = public as $$
declare sim_title text;
begin
  if new.finished_at is not null and (tg_op = 'INSERT' or old.finished_at is null) then
    select title into sim_title from simulations where id = new.simulation_id;
    insert into timeline_events (event_type, node_type, node_id, summary, payload, actor_id, actor_type)
    values ('simulation_completed', 'simulation', new.simulation_id,
            format('Simulation run completed: "%s"', coalesce(sim_title, 'unknown')),
            jsonb_build_object('run_id', new.id),
            auth.uid(), 'system');
  end if;
  return new;
end $$;

create trigger trg_simulation_completed after insert or update on simulation_runs
  for each row execute function log_simulation_completed();

-- ─── §2.7 Knowledge Engine: Confidence & Contradiction Functions ─────────────

-- Suggested confidence from linked evidence (advisory — admins confirm).
-- score = 50 + Σ(signed weighted evidence) scaled to ±50, damped by evidence count.
create function suggested_confidence(h_id uuid) returns int
language sql stable as $$
  with e as (
    select he.relation, he.weight, ev.strength, coalesce(s.reliability, 50) as reliability
    from hypothesis_evidence he
    join evidence ev on ev.id = he.evidence_id
    left join sources s on s.id = ev.source_id
    where he.hypothesis_id = h_id
  ),
  scored as (
    select case relation when 'supports' then 1 when 'opposes' then -1 else 0 end
           * (weight/100.0) * (strength/100.0) * (reliability/100.0) as signal
    from e
  )
  select greatest(0, least(100,
    round(50 + 50 * coalesce(sum(signal),0) / greatest(sqrt(count(*)::numeric), 1))
  ))::int
  from scored;
$$;

-- Contradiction scan: hypotheses sharing evidence with opposite relations.
create function scan_contradictions() returns int
language plpgsql security definer set search_path = public as $$
declare inserted int := 0;
begin
  -- Defense in depth: API routes gate this behind an admin session; the
  -- service role and SQL editor (auth.uid() is null) are also allowed.
  if auth.uid() is not null and not is_admin() then
    raise exception 'Only admins may run the contradiction scan.';
  end if;

  insert into contradictions (hypothesis_a, hypothesis_b, kind, explanation, detected_by)
  select distinct least(a.hypothesis_id, b.hypothesis_id),
         greatest(a.hypothesis_id, b.hypothesis_id),
         'evidential',
         'These hypotheses draw opposite conclusions from the same evidence.',
         'system'
  from hypothesis_evidence a
  join hypothesis_evidence b
    on a.evidence_id = b.evidence_id
   and a.relation = 'supports' and b.relation = 'opposes'
   and a.hypothesis_id <> b.hypothesis_id
  on conflict do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end $$;

-- Anonymous view-counter increment for hypothesis detail pages. Deliberately
-- silent in the timeline (see log_hypothesis_update).
create function increment_popularity(h_id uuid) returns void
language sql security definer set search_path = public as $$
  update hypotheses set popularity = popularity + 1 where id = h_id;
$$;

-- ─── §2.8 Full-Text Search ───────────────────────────────────────────────────

alter table hypotheses add column fts tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(title,'')), 'A') ||
    setweight(to_tsvector('english', coalesce(description,'')), 'B')
  ) stored;
create index idx_hypotheses_fts on hypotheses using gin(fts);

alter table questions add column fts tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(title,'')), 'A') ||
    setweight(to_tsvector('english', coalesce(description,'')), 'B') ||
    setweight(to_tsvector('english', coalesce(current_explanations,'')), 'C')
  ) stored;
create index idx_questions_fts on questions using gin(fts);

alter table evidence add column fts tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(title,'')), 'A') ||
    setweight(to_tsvector('english', coalesce(summary,'')), 'B')
  ) stored;
create index idx_evidence_fts on evidence using gin(fts);

alter table research_notes add column fts tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(title,'')), 'A') ||
    setweight(to_tsvector('english', coalesce(body,'')), 'B')
  ) stored;
create index idx_research_notes_fts on research_notes using gin(fts);

alter table simulations add column fts tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(title,'')), 'A') ||
    setweight(to_tsvector('english', coalesce(description,'')), 'B')
  ) stored;
create index idx_simulations_fts on simulations using gin(fts);

-- Unified search across all node types. Runs as invoker, so RLS applies
-- (drafts stay hidden from anonymous searchers).
create function global_search(q text, lim int default 20)
returns table (node_type node_type, id uuid, slug text, title text, snippet text, rank real)
language sql stable as $$
  select * from (
    select 'hypothesis'::node_type, h.id, h.slug, h.title,
           ts_headline('english', h.description, websearch_to_tsquery('english', q)),
           ts_rank(h.fts, websearch_to_tsquery('english', q)) as rank
    from hypotheses h where h.fts @@ websearch_to_tsquery('english', q)
    union all
    select 'question', qu.id, qu.slug, qu.title,
           ts_headline('english', qu.description, websearch_to_tsquery('english', q)),
           ts_rank(qu.fts, websearch_to_tsquery('english', q))
    from questions qu where qu.fts @@ websearch_to_tsquery('english', q)
    union all
    select 'evidence', e.id, e.slug, e.title,
           ts_headline('english', e.summary, websearch_to_tsquery('english', q)),
           ts_rank(e.fts, websearch_to_tsquery('english', q))
    from evidence e where e.fts @@ websearch_to_tsquery('english', q)
  ) s order by rank desc limit lim;
$$;

-- ─── §1.2-3 Uniform node identity ────────────────────────────────────────────

-- security_invoker so the underlying tables' RLS applies to readers.
create view graph_nodes with (security_invoker = on) as
  select 'domain'::node_type as type, d.id, d.slug, d.name as label,
         null::epistemic_status as status, null::int as confidence
  from domains d
  union all
  select 'question', q.id, q.slug, q.title, q.status, null
  from questions q
  union all
  select 'hypothesis', h.id, h.slug, h.title, h.status, h.confidence
  from hypotheses h
  union all
  select 'evidence', e.id, e.slug, e.title, null, e.strength
  from evidence e
  union all
  select 'simulation', s.id, s.slug, s.title, null, null
  from simulations s;

-- ─── §2.9 Row-Level Security ─────────────────────────────────────────────────

alter table profiles            enable row level security;
alter table domains             enable row level security;
alter table questions           enable row level security;
alter table hypotheses          enable row level security;
alter table sources             enable row level security;
alter table evidence            enable row level security;
alter table hypothesis_evidence enable row level security;
alter table graph_edges         enable row level security;
alter table contradictions      enable row level security;
alter table timeline_events     enable row level security;
alter table confidence_history  enable row level security;
alter table simulations         enable row level security;
alter table simulation_runs     enable row level security;
alter table research_notes      enable row level security;

-- profiles: users read/update own row; admins manage all. role changes are
-- additionally guarded by trg_guard_role.
create policy "own profile read" on profiles
  for select using (id = auth.uid() or is_admin());
create policy "own profile update" on profiles
  for update using (id = auth.uid() or is_admin())
  with check (id = auth.uid() or is_admin());

-- domains
create policy "public read" on domains for select using (true);
create policy "admin write" on domains for all using (is_admin()) with check (is_admin());

-- questions
create policy "public read" on questions for select using (true);
create policy "admin write" on questions for all using (is_admin()) with check (is_admin());

-- hypotheses: drafts are admin-only.
create policy "public read" on hypotheses
  for select using (state <> 'draft' or is_admin());
create policy "admin write" on hypotheses
  for all using (is_admin()) with check (is_admin());

-- sources
create policy "public read" on sources for select using (true);
create policy "admin write" on sources for all using (is_admin()) with check (is_admin());

-- evidence
create policy "public read" on evidence for select using (true);
create policy "admin write" on evidence for all using (is_admin()) with check (is_admin());

-- hypothesis_evidence
create policy "public read" on hypothesis_evidence for select using (true);
create policy "admin write" on hypothesis_evidence for all using (is_admin()) with check (is_admin());

-- graph_edges (system rows are written by security-definer triggers)
create policy "public read" on graph_edges for select using (true);
create policy "admin write" on graph_edges for all using (is_admin()) with check (is_admin());

-- contradictions (inserts come from the security-definer scan; admins resolve)
create policy "public read" on contradictions for select using (true);
create policy "admin write" on contradictions for all using (is_admin()) with check (is_admin());

-- timeline_events: SELECT for everyone; INSERT only via security-definer
-- triggers; no UPDATE/DELETE policies ever (append-only, §10 invariant 3).
create policy "public read" on timeline_events for select using (true);

-- confidence_history: SELECT for everyone; writes only via trigger.
create policy "public read" on confidence_history for select using (true);

-- simulations / simulation_runs
create policy "public read" on simulations for select using (true);
create policy "admin write" on simulations for all using (is_admin()) with check (is_admin());
create policy "public read" on simulation_runs for select using (true);
create policy "admin write" on simulation_runs for all using (is_admin()) with check (is_admin());

-- research_notes: public read only when published.
create policy "public read" on research_notes
  for select using (published or is_admin());
create policy "admin write" on research_notes
  for all using (is_admin()) with check (is_admin());

-- ─── §2.10 Dashboard Aggregates (Materialized View) ──────────────────────────

-- Created WITH NO DATA (tables are empty mid-migration); the seed and the
-- refresh RPC populate it.
create materialized view dashboard_stats as
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
     group by d.name order by n desc) t)                             as activity_by_domain,
  now()                                                              as refreshed_at
with no data;

-- Refresh hook for route handlers / scheduled functions. Owned by the
-- migration role so it can refresh; callable only by service role & admins.
create function refresh_dashboard_stats() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not is_admin() then
    raise exception 'Only admins may refresh dashboard stats.';
  end if;
  refresh materialized view dashboard_stats;
end $$;

-- ─── Grants ──────────────────────────────────────────────────────────────────

-- PostgREST exposes the matview & view read-only.
grant select on dashboard_stats to anon, authenticated;
grant select on graph_nodes to anon, authenticated;

-- Function execution: search & suggestion are public; mutating/maintenance
-- functions are kept away from anon (their bodies also self-guard).
revoke execute on function scan_contradictions() from public, anon;
revoke execute on function refresh_dashboard_stats() from public, anon;
grant execute on function scan_contradictions() to authenticated, service_role;
grant execute on function refresh_dashboard_stats() to authenticated, service_role;
grant execute on function global_search(text, int) to anon, authenticated;
grant execute on function suggested_confidence(uuid) to anon, authenticated;
grant execute on function increment_popularity(uuid) to anon, authenticated;

-- ─── Storage: artifacts bucket for simulation runs (§2.5 artifact_path) ──────

do $$
begin
  insert into storage.buckets (id, name, public)
  values ('artifacts', 'artifacts', true)
  on conflict (id) do nothing;
exception when others then
  -- Storage schema may be absent outside Supabase (e.g. bare Postgres CI).
  raise notice 'storage bucket not created: %', sqlerrm;
end $$;
