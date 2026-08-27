-- ═══════════════════════════════════════════════════════════════════════════
-- VERITAS — 0010_council.sql   (Post-1.0 Phase D, stage 3)
--
-- The council: four roles argue a claim over N rounds, in public, and the
-- outcome lands in the queue like anything else.
--
-- §D.3. Two tables, both PUBLIC — the transcript is the transparency artifact of
-- this phase. The queue stays private (§D.7): what an agent ARGUED and what it
-- got APPROVED are public record; what it has proposed and not yet had accepted
-- is not.
--
-- The council gains no power. Its verdict is an ordinary `pending` suggestion
-- written through the ordinary propose path, so enforce_agent_quota() fires on
-- it exactly as it does for a researcher. There is no trigger, function, or
-- grant in this file by which a council row can reach suggestions.status —
-- the same enforcement-by-absence as the skeptic lane in 0008.
--
-- NUMBERING: §D.6 called this migration `0009_council.sql`. 0009 was taken by
-- the F-07 default-privileges fix (2026-08-11), so council is 0010 and Internal
-- Affairs becomes 0011. The design table in DECISIONS.md is stale on the
-- numbers only; the contents below are as designed.
--
-- Depends on 0007 (agents), 0008 (the critique lane), and 0009 (see the grants
-- section — 0009 changed what a new table inherits, and this is the first
-- migration to land after it). Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── New enums ───────────────────────────────────────────────────────────────
-- Both are NEW types, so Postgres permits creating and using them in the same
-- transaction; there is no ALTER TYPE ... ADD VALUE anywhere in Phase D (§D.6),
-- which is what forced the 0005/0006 split.

do $$ begin
  create type council_role as enum ('advocate', 'skeptic', 'verifier', 'synthesizer');
exception when duplicate_object then null; end $$;

-- No 'majority' and no 'winner'. A 2–2 split is a RESULT, stored as `split`
-- with each role's final position in `vote`, and the synthesizer is instructed
-- to write what each side would need to see to change its mind rather than to
-- pick a side. `no_verdict` is for a council that ran out of rounds or budget —
-- an honest empty answer, not a manufactured one.
do $$ begin
  create type council_outcome as enum ('consensus', 'split', 'no_verdict');
exception when duplicate_object then null; end $$;


-- ─── D.3 councils ────────────────────────────────────────────────────────────
--
-- subject_type reuses node_type + a CHECK rather than introducing a third enum,
-- exactly as suggestions.target_type does (0003:60). subject_id carries NO
-- foreign key because the subject is polymorphic — a hypothesis or a question —
-- and Postgres has no polymorphic FK. Two consequences, both deliberate:
--   * referential integrity is the runner's job on write, and subject_slug /
--     subject_title are denormalized so a transcript still renders on its own;
--   * deleting the subject ORPHANS the council rather than cascading it away.
--     That is the wanted direction: the deliberation is a public record of what
--     was argued, and deleting the claim should not silently erase the debate
--     about it. An orphan renders from its stored slug and title, unlinked.
--
-- `status` is a lifecycle flag, not a domain vocabulary, so it is text + CHECK —
-- the shape agent_incidents.kind (0007) and citation_checks.matched_via (0008)
-- already use — which keeps this migration to the two enums §D.6 names.

create table if not exists councils (
  id            uuid primary key default gen_random_uuid(),
  subject_type  node_type not null,
  subject_id    uuid not null,
  subject_slug  text not null default '',
  subject_title text not null default '',
  status        text not null default 'running',
  rounds_run    int not null default 0,
  outcome       council_outcome,
  vote          jsonb not null default '{}',     -- {role: final position}
  verdict       text not null default '',        -- the synthesizer's write-up
  suggestion_id uuid references suggestions(id) on delete set null,
  model         text not null default '',
  abort_reason  text not null default '',
  started_at    timestamptz not null default now(),
  completed_at  timestamptz,
  constraint councils_subject_kind
    check (subject_type in ('hypothesis', 'question')),
  constraint councils_status_kind
    check (status in ('running', 'complete', 'aborted')),
  -- A council that stopped must say WHY it stopped. An `aborted` row with an
  -- empty reason is exactly the soft-failure shape this repo keeps a catalogue
  -- of: it reads as "nothing happened" when something did.
  constraint councils_abort_has_reason
    check (status <> 'aborted' or abort_reason <> ''),
  -- A completed council must have reached one of the three outcomes, no_verdict
  -- included. `complete` with a null outcome would be a fourth, unnamed state.
  constraint councils_complete_has_outcome
    check (status <> 'complete' or outcome is not null)
);

create index if not exists idx_councils_subject
  on councils (subject_type, subject_id, started_at desc);
create index if not exists idx_councils_completed
  on councils (completed_at desc);
create index if not exists idx_councils_suggestion
  on councils (suggestion_id);


-- ─── D.3 the verdict's shape, enforced here rather than in the runner ────────
--
-- SETTLED DECISION (§D.10 q3, the B.9 deviation-4 shape): a council convened on
-- a QUESTION proposes its edit against that question's most contested hypothesis
-- and says so in the rationale. It does NOT widen suggestions.target_type to
-- include 'question', because that would mean a new branch inside
-- apply_suggestion() — the most safety-critical function in the schema.
--
-- That decision is worth exactly as much as its enforcement. Left to the runner
-- it is a convention that one commit can forget; here it is a transition
-- Postgres refuses to express. The trigger fires only when a council is linked
-- to a suggestion, and asserts that suggestion targets a hypothesis.
--
-- security definer because the linked row lives in `suggestions`, which is
-- admin-only under RLS — the check must not silently pass for a caller who
-- merely cannot SEE the row. It reads one column and writes nothing.

create or replace function assert_council_verdict_shape() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_target node_type;
begin
  if new.suggestion_id is null then
    return new;
  end if;

  select target_type into v_target from suggestions where id = new.suggestion_id;

  if not found then
    raise exception 'Council % references suggestion %, which does not exist.',
      new.id, new.suggestion_id
      using errcode = '23503';
  end if;

  if v_target <> 'hypothesis' then
    raise exception
      'A council verdict must target a hypothesis, not %. A council on a question proposes against that question''s most contested hypothesis (DECISIONS B.9 deviation 4 / D.3), so apply_suggestion() stays untouched.',
      v_target
      using errcode = '23514';
  end if;

  return new;
end $$;

drop trigger if exists trg_councils_verdict_shape on councils;
create trigger trg_councils_verdict_shape before insert or update on councils
  for each row execute function assert_council_verdict_shape();


-- ─── D.3 council_turns ───────────────────────────────────────────────────────
--
-- `reasoning` is stored SEPARATELY from `content` because §D.3 requires sharing
-- reasoning chains between rounds, not just conclusions: the next round's prompt
-- is built from prior `reasoning`, and the public transcript renders both. One
-- merged text column would make the prompt builder re-parse its own output.
--
-- SETTLED DECISION (the context budget): per-turn output is capped (~400 tokens)
-- and prior turns are fed in newest-first until a context budget is reached,
-- with an explicit `[earlier turns truncated]` marker in the prompt.
-- `context_truncated` records that this turn ARGUED FROM A TRUNCATED TRANSCRIPT.
-- Without the column that marker lives only inside a prompt string that is never
-- stored, and a round-3 turn that never saw round 1 is indistinguishable from
-- one that did — which would look like reasoning and would not be. It is the
-- part of the budget decision that has to be durable in order to be auditable.
--
-- agent_id is `on delete set null` and agent_name is denormalized: retiring an
-- agent must not blank the public record of what it argued.

create table if not exists council_turns (
  id                uuid primary key default gen_random_uuid(),
  council_id        uuid not null references councils(id) on delete cascade,
  round             int not null,
  seq               int not null,
  role              council_role not null,
  agent_id          uuid references agents(id) on delete set null,
  agent_name        text not null default '',
  content           text not null default '',
  reasoning         text not null default '',
  context_truncated boolean not null default false,
  created_at        timestamptz not null default now(),
  constraint council_turns_round_positive check (round >= 1),
  unique (council_id, round, seq)
);

create index if not exists idx_council_turns_council
  on council_turns (council_id, round, seq);


-- ─── RLS: read is public, write is admin/service only ────────────────────────
-- Anon gets SELECT and nothing else. The runner writes as service_role, which
-- bypasses RLS; an admin can correct a transcript through the admin client.
-- Note what is NOT here: no policy, trigger, or grant gives any agent identity
-- a write path to `suggestions` by way of these tables.

alter table councils enable row level security;
drop policy if exists "public read councils" on councils;
create policy "public read councils" on councils
  for select using (true);
drop policy if exists "admin write councils" on councils;
create policy "admin write councils" on councils
  for all using (is_admin()) with check (is_admin());

alter table council_turns enable row level security;
drop policy if exists "public read council_turns" on council_turns;
create policy "public read council_turns" on council_turns
  for select using (true);
drop policy if exists "admin write council_turns" on council_turns;
create policy "admin write council_turns" on council_turns
  for all using (is_admin()) with check (is_admin());


-- ─── Grants — and why they are not a formality here ──────────────────────────
--
-- 0001:806 set `alter default privileges ... grant select on tables to anon`,
-- and every public table since has inherited anon SELECT for free. 0009 REVOKED
-- that default. THIS IS THE FIRST MIGRATION TO CREATE A PUBLIC TABLE AFTER
-- 0009, so these two grants are load-bearing in a way the equivalent lines in
-- 0007/0008 were not: without them RLS says "yes" while the grant says "no",
-- every row is denied to anon, and /council/[id] renders empty with HTTP 200.
-- That is the 0002 failure exactly, and it is the one that hides best.

grant select on councils      to anon, authenticated;
grant select on council_turns to anon, authenticated;

grant select, insert, update, delete on councils      to authenticated;
grant select, insert, update, delete on council_turns to authenticated;

grant all on councils      to service_role;
grant all on council_turns to service_role;

-- The verdict-shape function is enforcement, not a utility: nothing should call
-- it directly, and a trigger does not need EXECUTE granted in order to fire.
revoke execute on function assert_council_verdict_shape() from public, anon, authenticated;


-- ─── Verification — the F-07 guard, extended to this migration's tables ──────
--
-- 0009 ships a keep-public assertion over the relations an unauthenticated page
-- reads. That list is NOT edited here: 0009 has been applied, and its file is
-- the record of what ran. New public relations carry their own guard instead, in
-- the migration that creates them. This block proves the grants above actually
-- landed under 0009's new default rather than assuming that they did.
do $$
declare
  keep_public text[] := array[
    'councils',       -- lib/queries/councils.ts  <- app/(public)/council/[id]/page.tsx
    'council_turns'   -- lib/queries/councils.ts  <- app/(public)/council/[id]/page.tsx
  ];
  rel     text;
  missing text[] := '{}';
begin
  foreach rel in array keep_public loop
    if to_regclass('public.' || rel) is null then
      missing := missing || (rel || ' (relation absent)');
    elsif not has_table_privilege('anon', 'public.' || rel, 'SELECT') then
      missing := missing || (rel || ' (anon has no SELECT)');
    end if;
  end loop;

  if array_length(missing, 1) is not null then
    raise exception
      'D.3 guard: anon cannot read %. Since 0009 a new table inherits NO anon grant, so RLS would say yes while the grant says no — the 0002 failure shape: every row denied, transcripts render empty with HTTP 200. Refusing to apply.',
      array_to_string(missing, ', ');
  end if;

  raise notice 'D.3: anon SELECT confirmed on councils, council_turns.';
end $$;

-- Assert the settled shape is actually enforced, not merely intended. If the
-- trigger were missing, a council on a question could quietly link a suggestion
-- with target_type='question' and fail deep inside apply_suggestion() at
-- approval time — long after the run that produced it.
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.councils'::regclass
      and tgname  = 'trg_councils_verdict_shape'
      and not tgisinternal
  ) then
    raise exception 'D.3 guard: the verdict-shape trigger is not installed on councils.';
  end if;

  raise notice 'D.3: verdict-shape trigger installed (deviation-4 shape enforced in Postgres).';
end $$;
