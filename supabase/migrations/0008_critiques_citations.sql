-- ═══════════════════════════════════════════════════════════════════════════
-- VERITAS — 0008_critiques_citations.sql   (Post-1.0 Phase D, stage 2)
--
-- The skeptic lane and the citation verifier.
--
-- §D.2: every research proposal is critiqued by an adversarial agent BEFORE a
-- human sees it, and the critique travels with the proposal. The skeptic
-- ANNOTATES — it cannot block. That is enforced by absence: there is no trigger,
-- function, or grant here by which a critique can reach suggestions.status.
--
-- §D.5a: citations are resolved against Crossref/OpenAlex and the result is
-- keyed on the CITATION, not on the proposal, so nothing has to carry a result
-- across approval and apply_suggestion() is untouched.
--
-- Depends on 0007. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

do $$ begin
  create type critique_verdict as enum (
    'weak_assumption', 'evidence_thin', 'confidence_overstated', 'scope_creep', 'sound'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type citation_status as enum ('verified', 'unresolved', 'mismatch');
exception when duplicate_object then null; end $$;

-- ─── D.2 critiques ───────────────────────────────────────────────────────────
-- 'sound' is a first-class verdict on purpose. Without it the skeptic is
-- rewarded for manufacturing objections, which is the same conformity failure
-- as rubber-stamping, only inverted — and a claim that survived a real attack is
-- worth more to a reviewer than one that was never tested.

create table if not exists suggestion_critiques (
  id              uuid primary key default gen_random_uuid(),
  suggestion_id   uuid not null references suggestions(id) on delete cascade,
  critic_agent_id uuid references agents(id) on delete set null,
  critic_name     text not null default '',
  verdict         critique_verdict not null,
  body            text not null,
  findings        jsonb not null default '[]',
  created_at      timestamptz not null default now(),
  unique (suggestion_id, critic_agent_id)
);

create index if not exists idx_critiques_suggestion on suggestion_critiques (suggestion_id);

-- Admin-only, exactly like the suggestions they annotate: a critique describes
-- unreviewed content, so publishing it would leak the queue (§D.7). The public
-- deliberation artifact is the council transcript, not this.
alter table suggestion_critiques enable row level security;
drop policy if exists "admin manage critiques" on suggestion_critiques;
create policy "admin manage critiques" on suggestion_critiques
  for all using (is_admin()) with check (is_admin());

-- ─── D.2 one transaction: proposal + its critique ────────────────────────────
-- The critique must exist before the proposal is visible in review, but it needs
-- the suggestion's id as a foreign key. Doing it as two sequential inserts would
-- leave a window in which an uncritiqued proposal sits in the queue. So both
-- rows are written here, atomically.
--
-- This function deliberately does NOT bypass anything: it inserts into
-- suggestions exactly as the route would, so the enforce_agent_quota BEFORE
-- INSERT trigger still fires and every cap, scope check, and agent_name
-- re-stamp applies. It is security definer only so it can write the critique
-- row (admin-RLS) on behalf of a caller that is not an admin.
--
-- It cannot set status: the insert hard-codes 'pending'. There is no parameter,
-- and no branch, by which a critique influences the outcome.

create or replace function propose_with_critique(
  p_target_type   node_type,
  p_operation     suggestion_operation,
  p_target_id     uuid,
  p_payload       jsonb,
  p_rationale     text,
  p_proposed_by   uuid,
  p_agent_name    text,
  p_critic_name   text,
  p_verdict       critique_verdict,
  p_body          text,
  p_findings      jsonb
) returns suggestions
language plpgsql security definer set search_path = public as $$
declare
  s        suggestions;
  v_critic uuid;
begin
  insert into suggestions (
    target_type, operation, target_id, payload, rationale,
    proposed_by, actor_type, agent_name, status
  ) values (
    p_target_type, p_operation, p_target_id, p_payload, p_rationale,
    p_proposed_by, 'agent', p_agent_name, 'pending'      -- never anything else
  )
  returning * into s;

  select id into v_critic from agents where name = p_critic_name;

  insert into suggestion_critiques (
    suggestion_id, critic_agent_id, critic_name, verdict, body, findings
  ) values (
    s.id, v_critic, p_critic_name, p_verdict, p_body, coalesce(p_findings, '[]'::jsonb)
  );

  return s;
end $$;

revoke execute on function propose_with_critique(
  node_type, suggestion_operation, uuid, jsonb, text, uuid, text, text,
  critique_verdict, text, jsonb
) from public, anon;
grant execute on function propose_with_critique(
  node_type, suggestion_operation, uuid, jsonb, text, uuid, text, text,
  critique_verdict, text, jsonb
) to service_role;

-- ─── D.5a citation checks, keyed on the citation ─────────────────────────────
-- citation_key is a normalized DOI when there is one, else a normalized URL.
-- Keying here rather than on a suggestion or evidence row means a result does
-- not have to be carried across approval — the queue and the public evidence
-- page both look it up by the citation they already hold — and two agents citing
-- the same DOI resolve it once.
--
-- Public: this is a fact about a public citation, not about unreviewed content.

create table if not exists citation_checks (
  citation_key   text primary key,
  doi            text,
  url            text,
  claimed_title  text not null default '',
  status         citation_status not null,
  resolved_title text,
  resolved_year  int,
  matched_via    text not null default '',        -- 'doi' | 'title'
  score          numeric(4,3),                    -- title similarity, 0.000–1.000
  source         text not null default '',        -- 'crossref' | 'openalex'
  raw            jsonb not null default '{}',
  checked_at     timestamptz not null default now()
);

create index if not exists idx_citation_checks_doi on citation_checks (doi);

alter table citation_checks enable row level security;
drop policy if exists "public read citation_checks" on citation_checks;
create policy "public read citation_checks" on citation_checks
  for select using (true);
drop policy if exists "admin write citation_checks" on citation_checks;
create policy "admin write citation_checks" on citation_checks
  for all using (is_admin()) with check (is_admin());

grant select on citation_checks to anon, authenticated;
grant select, insert, update, delete on citation_checks to authenticated;
grant all on citation_checks to service_role;

grant select, insert, update, delete on suggestion_critiques to authenticated;
grant all on suggestion_critiques to service_role;
revoke all on suggestion_critiques from anon;
