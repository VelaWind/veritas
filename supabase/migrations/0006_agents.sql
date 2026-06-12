-- ═══════════════════════════════════════════════════════════════════════════
-- VERITAS — 0006_agents.sql   (Post-1.0 Phase B, stage 1b)
--
-- Agent identities, scoped bearer tokens, authoritative server-side queue caps,
-- and a trust governor. An agent is JUST ANOTHER CONTRIBUTOR (§10 / DECISIONS
-- §B.0): it proposes into the SAME `suggestions` queue (actor_type='agent'),
-- through the SAME apply_suggestion() path, under the SAME epistemic constraints
-- and audit triggers as a human — and a human admin approves every proposal.
--
-- This migration adds NO write path to the knowledge tables, grants an agent NO
-- is_admin() and NO knowledge-table reach, and weakens NO existing RLS policy,
-- CHECK constraint, or auth gate. The only new enforcement is *tighter*: a
-- BEFORE INSERT cap trigger that binds agent proposals even if a runner's
-- client-side caps are bypassed.
--
-- Depends on 0005 (the 'agent' user_role value). Idempotent where practical.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── is_contributor(): widen to include agents (defense in depth) ─────────────
-- The token propose path inserts server-side (route → service role), so this is
-- not the primary gate for agents; but if an agent ever holds a session JWT it
-- stays RLS-scoped to its OWN pending suggestions, exactly like a researcher.
-- Never widened to is_admin(): an agent can never approve (apply_suggestion()
-- self-guards on is_admin()). role::text avoids coercing the literal 'agent' to
-- the enum, so this is safe even if 0005/0006 share one push transaction.

create or replace function is_contributor() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and exists (
       select 1 from profiles
       where id = auth.uid()
         and role::text in ('researcher', 'admin', 'agent')
     );
$$;

-- ─── agents registry ─────────────────────────────────────────────────────────
-- One row per agent. profile_id anchors a deliberately under-privileged Supabase
-- identity (role 'agent', set by the admin mint tool). scopes bounds the agent:
--   { domains:[uuid…], max_pending:int, max_per_run:int, max_per_hour:int }
-- trust is derived from the agent's approve/reject history (recompute below).

create table if not exists agents (
  id          uuid primary key default gen_random_uuid(),
  name        text unique not null,                 -- → suggestions.agent_name
  profile_id  uuid not null references profiles(id) on delete cascade,
  enabled     boolean not null default true,
  scopes      jsonb not null default '{}',
  trust       int not null default 50 check (trust between 0 and 100),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (profile_id)
);

create index if not exists idx_agents_profile on agents (profile_id);

drop trigger if exists trg_touch_agents on agents;
create trigger trg_touch_agents before update on agents
  for each row execute function touch_updated_at();

-- ─── agent_tokens: hashed, expiring, revocable scoped bearer tokens ───────────
-- Server-to-server credentials (NOT Supabase sessions, NOT the service key). The
-- plaintext is shown ONCE at mint and never stored; only its SHA-256 hex lives
-- here. requireAgent() (lib/api.ts) accepts a token ONLY on the propose endpoint.

create table if not exists agent_tokens (
  id           uuid primary key default gen_random_uuid(),
  agent_id     uuid not null references agents(id) on delete cascade,
  token_hash   text unique not null,
  label        text not null default '',
  expires_at   timestamptz,
  revoked_at   timestamptz,
  last_used_at timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists idx_agent_tokens_hash on agent_tokens (token_hash);

-- ─── RLS: agents & agent_tokens are admin/service only ───────────────────────
-- Never readable by anon, authenticated-non-admin, or agents themselves. Token
-- validation runs under the service role (requireAgent), which bypasses RLS.

alter table agents enable row level security;
drop policy if exists "admin manage agents" on agents;
create policy "admin manage agents" on agents
  for all using (is_admin()) with check (is_admin());

alter table agent_tokens enable row level security;
drop policy if exists "admin manage agent_tokens" on agent_tokens;
create policy "admin manage agent_tokens" on agent_tokens
  for all using (is_admin()) with check (is_admin());

-- ─── B.2 server-side queue caps (authoritative; independent of the runner) ───
-- BEFORE INSERT on suggestions. No-op for humans (actor_type<>'agent'); for an
-- agent it resolves the registry row and enforces enabled + domain scope +
-- max_pending + rolling max_per_hour. A runaway or compromised token cannot
-- flood review past these caps. Distinct SQLSTATEs let the route answer 429 vs
-- 403. It also re-stamps agent_name from the registry, so a caller cannot spoof
-- another agent's name.

create or replace function enforce_agent_quota() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  a             agents;
  v_domains     jsonb;
  v_max_pending int;
  v_max_hour    int;
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
  if not a.enabled then
    raise exception 'Agent "%" is disabled.', a.name
      using errcode = '42501';
  end if;

  new.agent_name := a.name;                      -- no spoofing the agent name

  v_domains     := coalesce(a.scopes->'domains', '[]'::jsonb);
  v_max_pending := coalesce((a.scopes->>'max_pending')::int, 20);
  v_max_hour    := coalesce((a.scopes->>'max_per_hour')::int, 30);

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

drop trigger if exists trg_enforce_agent_quota on suggestions;
create trigger trg_enforce_agent_quota before insert on suggestions
  for each row execute function enforce_agent_quota();

-- ─── B.3 trust governor: derive trust from approve/reject history ────────────
-- trust = round(100 * approved / decided). Below the floor with enough decided
-- history the agent auto-disables, pending admin review — bounding the review
-- burden a misbehaving agent can impose. Recomputed by an AFTER UPDATE trigger
-- when an agent suggestion is decided, so the audited apply_suggestion()/reject
-- paths stay untouched. It writes only to `agents`, never back to suggestions,
-- so there is no trigger recursion.

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
    trust   = v_trust,
    enabled = case when v_decided >= 5 and v_trust < 20 then false else enabled end
  where profile_id = p_profile_id;
end $$;

create or replace function on_agent_suggestion_decided() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.actor_type = 'agent'
     and new.status in ('approved', 'rejected')
     and new.status is distinct from old.status then
    perform recompute_agent_trust(new.proposed_by);
  end if;
  return new;
end $$;

drop trigger if exists trg_agent_trust on suggestions;
create trigger trg_agent_trust after update of status on suggestions
  for each row execute function on_agent_suggestion_decided();

-- ─── Grants ──────────────────────────────────────────────────────────────────
-- 0001's ALTER DEFAULT PRIVILEGES grants anon SELECT on future tables; revoke it
-- explicitly so the agent registry and token hashes are never anon-readable.
-- authenticated keeps DML (RLS gates it to admins only); service_role full.

grant select, insert, update, delete on agents       to authenticated;
grant select, insert, update, delete on agent_tokens to authenticated;
grant all on agents       to service_role;
grant all on agent_tokens to service_role;
revoke all on agents       from anon;
revoke all on agent_tokens from anon;

revoke execute on function recompute_agent_trust(uuid) from public, anon;
grant  execute on function recompute_agent_trust(uuid) to authenticated, service_role;
