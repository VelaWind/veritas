-- ═══════════════════════════════════════════════════════════════════════════
-- VERITAS — 0007_agent_roster.sql   (Post-1.0 Phase D, stage 1)
--
-- The agent society, stage 1: agents get an expertise, a charter, a tri-state
-- status, and a PUBLIC profile — without exposing the registry itself.
--
-- Invariants unchanged (DECISIONS §D.0): no new write path to any knowledge
-- table, no agent gains is_admin(), apply_suggestion() is untouched, and the
-- only new enforcement is *tighter* (throttling). This migration weakens no RLS
-- policy, no CHECK constraint, and no auth gate.
--
-- Two Phase-B functions are REPLACED here (recompute_agent_trust,
-- enforce_agent_quota) so that `status` — not `enabled` — is authoritative.
-- Both replacements are behaviour-preserving for every case verify-agents.mjs
-- already covers; that script (19/19) is the gate for this migration.
--
-- Depends on 0006. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── New enums ───────────────────────────────────────────────────────────────
-- NOTE: these are NEW types, not new values on an existing enum, so Postgres
-- permits creating and using them in the same transaction. The 0005/0006 split
-- (B.9 deviation 3) was forced by ALTER TYPE ... ADD VALUE, which Phase D avoids
-- entirely — that is also why the public changelog derives council entries from
-- the councils table rather than from a new timeline_event_type value.

do $$ begin
  create type agent_kind as enum (
    'research', 'contradiction', 'skeptic', 'verifier', 'council', 'internal_affairs'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type agent_status as enum ('active', 'throttled', 'suspended');
exception when duplicate_object then null; end $$;

-- ─── D.1 registry: expertise, charter, status ────────────────────────────────
-- charter is the persona/research approach; it becomes the agent's system
-- prompt, so the expertise lives in text + domain scope, never in a second
-- model. domain_id is the DECLARED field of expertise and is deliberately
-- distinct from scopes.domains (the enforced token scope) — IA check #2 audits
-- the gap between the two.

alter table agents add column if not exists display_name text not null default '';
alter table agents add column if not exists kind    agent_kind   not null default 'research';
alter table agents add column if not exists charter text         not null default '';
alter table agents add column if not exists domain_id uuid references domains(id) on delete set null;
alter table agents add column if not exists status  agent_status not null default 'active';

create index if not exists idx_agents_domain on agents (domain_id);

-- Backfill display_name and, crucially, status FROM the existing enabled flag
-- BEFORE the derive trigger exists. Without this an agent the trust governor had
-- already auto-disabled would silently come back online at status='active'.
update agents set display_name = name where display_name = '';
update agents set status = 'suspended' where enabled = false and status = 'active';

-- ─── status is authoritative; enabled is derived ─────────────────────────────
-- `enabled` is what the (verified) quota trigger reads, so it stays — but it is
-- now a projection of `status`, not an independent switch. Consequence worth
-- knowing before you reach for it: `update agents set enabled = false` no longer
-- does anything on its own. Disable with `status = 'suspended'`.

create or replace function derive_agent_enabled() returns trigger
language plpgsql as $$
begin
  new.enabled := (new.status <> 'suspended');
  return new;
end $$;

drop trigger if exists trg_agents_derive_enabled on agents;
create trigger trg_agents_derive_enabled before insert or update on agents
  for each row execute function derive_agent_enabled();

-- Re-assert the projection for rows written before the trigger existed.
update agents set status = status;

-- ─── REPLACED (0006): trust governor now suspends via status ─────────────────
-- Identical arithmetic and identical floor (5 decided, trust < 20). The only
-- change is the write: `enabled = false` would be overwritten by the derive
-- trigger, so the governor sets status instead. It never un-suspends: an agent
-- whose trust recovers stays suspended until an admin reinstates it, which
-- matches D.4 (reinstatement is admin-only) and is the fail-safe direction.

create or replace function recompute_agent_trust(p_profile_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_approved int;
  v_rejected int;
  v_decided  int;
  v_trust    int;
begin
  select
    count(*) filter (where status = 'approved'),
    count(*) filter (where status = 'rejected')
  into v_approved, v_rejected
  from suggestions where proposed_by = p_profile_id;

  v_decided := v_approved + v_rejected;
  if v_decided = 0 then
    return;
  end if;
  v_trust := round(100.0 * v_approved / v_decided);

  update agents set
    trust  = v_trust,
    status = case
               when v_decided >= 5 and v_trust < 20 then 'suspended'::agent_status
               else status
             end
  where profile_id = p_profile_id;
end $$;

-- ─── REPLACED (0006): quota trigger honours status + throttling ──────────────
-- Byte-identical to 0006 except: it reports a suspended agent by status, and a
-- `throttled` agent's caps are divided by scopes.throttle_divisor (default 4,
-- floor 1). Throttling is how IA (D.4) applies a proportionate sanction without
-- stopping an agent outright. Humans remain unaffected — the first branch
-- returns before any of this.

create or replace function enforce_agent_quota() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  a             agents;
  v_domains     jsonb;
  v_max_pending int;
  v_max_hour    int;
  v_divisor     int;
  v_pending     int;
  v_recent      int;
  v_domain_id   text;
begin
  if new.actor_type <> 'agent' then
    return new;                                  -- humans are unaffected
  end if;

  select * into a from agents where profile_id = new.proposed_by;
  if not found then
    raise exception 'No agent is registered for this identity.'
      using errcode = '42501';
  end if;
  if a.status = 'suspended' or not a.enabled then
    raise exception 'Agent "%" is suspended.', a.name
      using errcode = '42501';
  end if;

  new.agent_name := a.name;                      -- no spoofing the agent name

  v_domains     := coalesce(a.scopes->'domains', '[]'::jsonb);
  v_max_pending := coalesce((a.scopes->>'max_pending')::int, 20);
  v_max_hour    := coalesce((a.scopes->>'max_per_hour')::int, 30);

  -- D.1 throttling: a proportionate sanction, not an outage.
  if a.status = 'throttled' then
    v_divisor     := greatest(1, coalesce((a.scopes->>'throttle_divisor')::int, 4));
    v_max_pending := greatest(1, v_max_pending / v_divisor);
    v_max_hour    := greatest(1, v_max_hour / v_divisor);
  end if;

  -- Domain scope: when the agent is restricted, the proposal's domain must be
  -- in the allowed set (a domainless proposal is rejected for a scoped agent).
  if jsonb_array_length(v_domains) > 0 then
    v_domain_id := new.payload->>'domain_id';
    if v_domain_id is null or not (v_domains ? v_domain_id) then
      raise exception 'Agent "%" is not scoped to domain %.',
        a.name, coalesce(v_domain_id, '(none)')
        using errcode = '42501';
    end if;
  end if;

  select count(*) into v_pending from suggestions
    where proposed_by = new.proposed_by and status = 'pending';
  if v_pending >= v_max_pending then
    raise exception 'Agent "%" is at its pending cap (% of %).',
      a.name, v_pending, v_max_pending
      using errcode = '53400';
  end if;

  select count(*) into v_recent from suggestions
    where proposed_by = new.proposed_by and created_at > now() - interval '1 hour';
  if v_recent >= v_max_hour then
    raise exception 'Agent "%" exceeded its hourly cap (% in the last hour, cap %).',
      a.name, v_recent, v_max_hour
      using errcode = '53400';
  end if;

  return new;
end $$;

-- ─── D.4 check #3 source: cap/scope refusals, recorded ───────────────────────
-- The quota trigger RAISES, which by definition leaves no row behind — so a
-- refusal is invisible to any later audit unless something records it. The
-- propose route writes one row here per 429/403. This ships in stage 1 rather
-- than with Internal Affairs so that there is real history to audit by the time
-- IA first runs, instead of an empty table and a meaningless "no incidents".

create table if not exists agent_incidents (
  id         uuid primary key default gen_random_uuid(),
  agent_id   uuid references agents(id) on delete cascade,
  agent_name text not null default '',
  kind       text not null,                       -- 'cap_exceeded' | 'scope_denied'
  sqlstate   text not null default '',
  detail     text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_agent_incidents_agent on agent_incidents (agent_id, created_at desc);

alter table agent_incidents enable row level security;
drop policy if exists "admin read agent_incidents" on agent_incidents;
create policy "admin read agent_incidents" on agent_incidents
  for all using (is_admin()) with check (is_admin());

-- ─── D.1 public surface: a projection, not a policy ──────────────────────────
-- RLS cannot restrict COLUMNS, and `agents` holds scopes and trust. So the
-- public surface is a view with a fixed column list, and that list IS the
-- security boundary.
--
-- These views are deliberately security_invoker = OFF (the default): they run as
-- owner and therefore bypass the admin-only RLS on `agents`/`suggestions`. That
-- is the exact inverse of graph_nodes in 0001, which is security_invoker = ON so
-- the reader's RLS applies. The inversion is intentional: there the row filter
-- was the boundary, here the column list is.
--
-- trust is NOT exposed (design review answer 1): the public profile carries the
-- approval rate and the last audit result; the raw trust score stays admin-only.

create or replace view agent_public as
  select
    a.name,
    a.display_name,
    a.kind,
    a.charter,
    a.status,
    d.slug as domain_slug,
    d.name as domain_name,
    a.created_at
  from agents a
  left join domains d on d.id = a.domain_id;

-- Counts only — never payloads, rationales, or any pending content. `suggestions`
-- stays entirely non-public (D.7): what an agent has proposed and not yet had
-- accepted is unreviewed, and publishing it would make the map look like it
-- contains claims it does not.

create or replace view agent_public_stats as
  select
    a.name,
    count(s.id)                                            as proposed,
    count(s.id) filter (where s.status = 'approved')       as approved,
    count(s.id) filter (where s.status = 'rejected')       as rejected,
    count(s.id) filter (where s.status = 'pending')        as pending,
    case
      when count(s.id) filter (where s.status in ('approved', 'rejected')) = 0
        then null
      else round(
        100.0 * count(s.id) filter (where s.status = 'approved')
              / count(s.id) filter (where s.status in ('approved', 'rejected'))
      )
    end                                                    as approval_rate
  from agents a
  left join suggestions s on s.proposed_by = a.profile_id
  group by a.name;

-- ─── Grants ──────────────────────────────────────────────────────────────────
-- The views are public; the base tables stay exactly as 0006 left them.

grant select on agent_public       to anon, authenticated;
grant select on agent_public_stats to anon, authenticated;

grant select, insert, update, delete on agent_incidents to authenticated;
grant all    on agent_incidents to service_role;
revoke all   on agent_incidents from anon;
