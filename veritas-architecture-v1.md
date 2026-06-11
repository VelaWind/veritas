# VERITAS — Version 1.0 Technical Architecture

**Document status:** Production blueprint
**Stack:** Next.js 14+ (App Router) · TypeScript · Tailwind CSS · Supabase (PostgreSQL, Auth, Storage) · Recharts · Vercel
**Design horizon:** Multi-decade. Every decision below favors durability, auditability, and schema extensibility over short-term convenience.

---

## 1. System Architecture Overview

### 1.1 High-Level Topology

```
┌─────────────────────────────────────────────────────────────────┐
│                          VERCEL EDGE                            │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │                  Next.js App Router                       │ │
│  │                                                           │ │
│  │  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐  │ │
│  │  │ Public Pages │  │ Admin Pages  │  │ Route Handlers  │  │ │
│  │  │ (RSC, SSG/   │  │ (RSC, auth-  │  │ /api/* (thin    │  │ │
│  │  │  ISR cached) │  │  gated)      │  │  layer over DB) │  │ │
│  │  └──────┬──────┘  └──────┬───────┘  └────────┬────────┘  │ │
│  └─────────┼────────────────┼───────────────────┼───────────┘ │
└────────────┼────────────────┼───────────────────┼─────────────┘
             │ anon key (RLS) │ session JWT (RLS) │ service role
             ▼                ▼                   ▼ (server only)
┌─────────────────────────────────────────────────────────────────┐
│                          SUPABASE                                │
│  ┌────────────┐ ┌──────────────┐ ┌───────────┐ ┌─────────────┐ │
│  │ PostgreSQL │ │ Auth (GoTrue)│ │  Storage  │ │ Edge Funcs  │ │
│  │ + RLS      │ │ email/OAuth  │ │ (figures, │ │ (confidence │ │
│  │ + FTS      │ │ + roles      │ │  datasets)│ │  recompute, │ │
│  │ + triggers │ │              │ │           │ │  contradiction│ │
│  └────────────┘ └──────────────┘ └───────────┘ │  scan)       │ │
│                                                 └─────────────┘ │
└──────────────────────────────────────────────────────────────────┘
             ▲
             │ (Phase 4+) AI Agent Layer — separate workers calling
             │ the same API with scoped service tokens
┌────────────┴────────────────────────────────────────────────────┐
│  Research Agent · Simulation Agent · Contradiction Agent ·       │
│  Philosophy Agent · Cosmology Agent · Consciousness Agent        │
└──────────────────────────────────────────────────────────────────┘
```

### 1.2 Architectural Principles

1. **The database is the source of truth, and the database enforces epistemics.** Epistemic status, confidence bounds, and evidence-link integrity are enforced by Postgres constraints and triggers — not by application code that can be bypassed. A speculation can never be stored as established knowledge, even by a buggy client or a future AI agent.
2. **Append-only history.** Hypotheses and evidence are mutable, but every change emits an immutable `timeline_events` record and a `confidence_history` record. The Timeline of Understanding is a *byproduct of the write path*, not a separately maintained feature.
3. **Everything is a node.** Questions, hypotheses, evidence, domains, and simulations share a uniform node identity (`graph_nodes` view) so the Research Graph, the search engine, and future AI agents traverse one consistent structure.
4. **Reads are public and cheap; writes are privileged and audited.** Public pages render from cached RSC/ISR with the anon key under row-level security. All mutations go through authenticated routes, are role-checked twice (middleware + RLS), and are attributed to an actor (human or agent).
5. **AI-ready, not AI-dependent.** V1.0 ships with zero AI calls, but every table that an agent will eventually write to includes `actor_type` (`human` | `agent`) and `agent_name`, and the API is structured so agents are just another authenticated client.

### 1.3 Rendering Strategy

| Surface | Strategy | Revalidation |
|---|---|---|
| Home, Domains | Static (SSG) + ISR | 1 hour, on-demand tag revalidation after admin writes |
| Dashboard | RSC with ISR | 15 min |
| Hypothesis / Evidence / Question detail | ISR per-slug | On-demand via `revalidateTag` on write |
| Search, filtered lists | Dynamic RSC (server-side query) | None (live) |
| Research Graph | Client component fed by cached JSON endpoint | 1 hour |
| Admin | Fully dynamic, no caching | — |

---

## 2. Database Schema (PostgreSQL / Supabase)

All tables live in schema `public`. Run as a single migration: `supabase/migrations/0001_core.sql`.

### 2.1 Enums

```sql
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
```

### 2.2 Identity & Roles

```sql
-- Mirrors auth.users; created by trigger on signup.
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role        user_role not null default 'public',
  created_at  timestamptz not null default now()
);

create function handle_new_user() returns trigger
language plpgsql security definer as $$
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
language sql stable security definer as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;
```

### 2.3 Core Knowledge Tables

```sql
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
  confidence_rationale text not null default '', -- REQUIRED to be non-empty before state='active' (trigger below)
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
-- and 'established' requires very strong confidence.
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
```

### 2.4 Graph, Contradictions, History

```sql
-- Generic typed edges between any two nodes (questions, hypotheses, evidence, domains, simulations).
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
  check (hypothesis_a <> hypothesis_b)
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
-- No UPDATE/DELETE policies are ever created for this table.

create table confidence_history (
  id            bigint generated always as identity primary key,
  hypothesis_id uuid not null references hypotheses(id) on delete cascade,
  old_value     int,
  new_value     int not null,
  rationale     text not null,
  actor_id      uuid references profiles(id),
  created_at    timestamptz not null default now()
);
```

### 2.5 Simulations & Research Notes

```sql
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
```

### 2.6 Triggers: History Is a Byproduct of Writes

```sql
create function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create trigger trg_touch_hypotheses before update on hypotheses
  for each row execute function touch_updated_at();
-- (same trigger on questions, evidence, research_notes)

-- Confidence changes are recorded automatically and require a rationale.
create function log_confidence_change() returns trigger
language plpgsql security definer as $$
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

create trigger trg_confidence on hypotheses
  before update on hypotheses for each row execute function log_confidence_change();

-- Linking evidence emits timeline events + graph edges automatically.
create function on_evidence_linked() returns trigger
language plpgsql security definer as $$
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
```

### 2.7 Knowledge Engine: Confidence & Contradiction Functions

```sql
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

-- Contradiction scan: hypotheses sharing strong evidence with opposite relations,
-- plus manually-declared logical conflicts via graph_edges.
create function scan_contradictions() returns int
language plpgsql security definer as $$
declare inserted int := 0;
begin
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
```

Run `scan_contradictions()` from a Supabase scheduled Edge Function (e.g., nightly) and after bulk evidence imports.

### 2.8 Full-Text Search

```sql
alter table hypotheses add column fts tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(title,'')), 'A') ||
    setweight(to_tsvector('english', coalesce(description,'')), 'B')
  ) stored;
create index idx_hypotheses_fts on hypotheses using gin(fts);
-- Repeat for questions(title, description, current_explanations),
-- evidence(title, summary), research_notes(title, body), simulations(title, description).

-- Unified search across all node types.
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
```

### 2.9 Row-Level Security

```sql
-- Pattern applied to every table:
alter table hypotheses enable row level security;

create policy "public read" on hypotheses
  for select using (state <> 'draft' or is_admin());

create policy "admin write" on hypotheses
  for all using (is_admin()) with check (is_admin());

-- timeline_events: SELECT for everyone, INSERT only via security-definer triggers.
-- profiles: users read/update own row; role column updatable only by admins
--   (enforced with a separate column-guard trigger).
-- research_notes: public read where published = true; admin full access.
-- simulation_runs / simulations: public read; admin write.
```

### 2.10 Dashboard Aggregates (Materialized View)

```sql
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
  now()                                                              as refreshed_at;

-- Refresh after admin writes (route handler calls rpc) and on a 15-min schedule.
```

---

## 3. Folder Structure (Next.js App Router)

```
veritas/
├── app/
│   ├── (public)/                       # Public-facing route group
│   │   ├── page.tsx                    # Home
│   │   ├── dashboard/page.tsx          # Reality Dashboard
│   │   ├── domains/
│   │   │   ├── page.tsx                # Domain index
│   │   │   └── [slug]/page.tsx         # Domain detail
│   │   ├── hypotheses/
│   │   │   ├── page.tsx                # Filterable database (searchParams-driven)
│   │   │   └── [slug]/page.tsx         # Hypothesis detail (evidence, history, graph)
│   │   ├── evidence/
│   │   │   ├── page.tsx
│   │   │   └── [slug]/page.tsx
│   │   ├── questions/
│   │   │   ├── page.tsx                # Unanswered Questions
│   │   │   └── [slug]/page.tsx
│   │   ├── timeline/page.tsx           # Timeline of Understanding (cursor-paginated)
│   │   ├── graph/page.tsx              # Research Graph (client component)
│   │   ├── lab/
│   │   │   ├── page.tsx                # Simulation Lab overview
│   │   │   └── [category]/page.tsx     # ecosystems | agents | civilizations | universes | consciousness
│   │   ├── search/page.tsx             # Global search results
│   │   └── notes/[slug]/page.tsx       # Published research notes
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   └── auth/callback/route.ts      # Supabase OAuth/PKCE callback
│   ├── admin/                          # Gated by middleware + layout role check
│   │   ├── layout.tsx                  # Server-side admin verification
│   │   ├── page.tsx                    # Admin overview
│   │   ├── hypotheses/                 # CRUD + evidence linking + confidence editor
│   │   ├── evidence/
│   │   ├── questions/
│   │   ├── simulations/
│   │   ├── notes/
│   │   └── contradictions/page.tsx     # Review & resolve queue
│   ├── api/                            # Route handlers (see §6)
│   │   ├── search/route.ts
│   │   ├── graph/route.ts
│   │   ├── stats/route.ts
│   │   ├── hypotheses/route.ts
│   │   ├── hypotheses/[id]/route.ts
│   │   ├── hypotheses/[id]/evidence/route.ts
│   │   ├── hypotheses/[id]/confidence/route.ts
│   │   ├── evidence/route.ts
│   │   ├── questions/route.ts
│   │   ├── simulations/route.ts
│   │   ├── contradictions/scan/route.ts
│   │   └── revalidate/route.ts
│   ├── layout.tsx                      # Root layout: theme, fonts, nav, footer
│   ├── globals.css                     # Design tokens (§5)
│   ├── not-found.tsx
│   └── sitemap.ts / robots.ts
├── components/
│   ├── ui/                             # Primitives: Button, Card, Badge, Dialog, Tabs,
│   │   └── ...                         #   Table, Input, Select, Tooltip, Skeleton
│   ├── epistemics/
│   │   ├── ConfidenceMeter.tsx         # The signature component (§5.5)
│   │   ├── EpistemicBadge.tsx          # Status taxonomy badge
│   │   ├── EvidenceCard.tsx
│   │   ├── EvidenceBalance.tsx         # For/against visual ledger
│   │   ├── AssumptionList.tsx
│   │   └── ContradictionFlag.tsx
│   ├── charts/                         # Recharts wrappers (themed)
│   │   ├── ConfidenceDistribution.tsx
│   │   ├── ActivitySparkline.tsx
│   │   └── DomainActivity.tsx
│   ├── graph/
│   │   ├── ResearchGraph.tsx           # Canvas/SVG force layout
│   │   └── GraphControls.tsx
│   ├── layout/  (SiteNav, Footer, CommandPalette ⌘K search)
│   └── admin/   (forms, MarkdownEditor, EvidenceLinker, ConfidenceEditor)
├── lib/
│   ├── supabase/
│   │   ├── client.ts                   # Browser client (anon)
│   │   ├── server.ts                   # RSC/route-handler client (cookies)
│   │   ├── admin.ts                    # Service-role client (server-only, never imported in client code)
│   │   └── middleware.ts               # Session refresh helper
│   ├── queries/                        # Typed data-access layer (one file per entity)
│   ├── knowledge-engine/
│   │   ├── confidence.ts               # Mirrors §2.7 formula for client-side preview
│   │   ├── taxonomy.ts                 # Epistemic status rules & labels
│   │   └── contradiction.ts
│   ├── validations/                    # Zod schemas shared by forms + API routes
│   └── utils.ts
├── types/
│   ├── database.types.ts               # `supabase gen types typescript`
│   └── domain.ts                       # App-level types (HypothesisWithEvidence, GraphNode…)
├── supabase/
│   ├── migrations/0001_core.sql
│   ├── seed.sql                        # 10 domains, ~20 questions, ~15 hypotheses, evidence
│   └── functions/                      # Edge functions: nightly-contradiction-scan, refresh-stats
├── middleware.ts                       # Protects /admin/*, refreshes auth session
├── tailwind.config.ts
└── .env.local                          # NEXT_PUBLIC_SUPABASE_URL / ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
```

---

## 4. Authentication & Authorization Flow

### 4.1 Flow

```
Visitor ──────────────► Public pages (anon key, RLS: read-only on published rows)

Admin login:
  /login → supabase.auth.signInWithPassword (or OAuth)
        → /auth/callback exchanges code, sets httpOnly cookies
        → middleware.ts refreshes session on every request
        → admin/layout.tsx (server): getUser() → profiles.role check
              role ≠ 'admin' → redirect('/')
        → Admin UI renders

Every mutation:
  Route handler → createServerClient(cookies) → getUser()
               → profiles.role check (defense layer 2)
               → DB write runs under user JWT → RLS check (defense layer 3)
               → trigger writes timeline_events (audit, layer 4)
               → revalidateTag(...) for affected public pages
```

### 4.2 Rules

- **Three independent gates** for every write: middleware route guard, handler role check, RLS policy. Compromising the UI alone cannot produce an unauthorized write.
- The **service-role key** exists only in server environment variables and is used solely for: stats refresh, contradiction scans, and seeding. It is never used for user-initiated mutations (those must carry user attribution for the audit trail).
- **Public users have no accounts in V1.0.** Signup is disabled in Supabase Auth settings; admins are provisioned manually (`update profiles set role='admin' where id=...`). A `researcher` role exists in the enum now so V1.x can add contributor workflows without a migration.
- Session cookies are httpOnly + Secure; PKCE flow for OAuth.

---

## 5. UI Design System

### 5.1 Aesthetic Direction

The brief asks for NASA + CERN + Wikipedia + Notion + Bloomberg Terminal: a serious scientific instrument, dark-first, with an undertone of mystery. The unifying concept: **"an observatory for knowledge."** The interface should feel like a precision instrument pointed at the unknown — quiet, dense where data demands it, generous with darkness elsewhere. The one deliberate aesthetic risk: *uncertainty itself is the visual language*. Confidence and epistemic status are rendered everywhere with a single consistent component vocabulary, so the page itself never looks more certain than the knowledge it displays.

### 5.2 Color Tokens (CSS variables in `globals.css`)

```css
:root[data-theme="dark"] {            /* default */
  --bg-void:      #060A12;   /* page background — near-black, blue-shifted like deep sky */
  --bg-surface:   #0C1320;   /* cards, panels */
  --bg-raised:    #131C2E;   /* hover states, popovers */
  --border:       #1E2A40;
  --text-primary: #E8EDF6;
  --text-muted:   #8A97AD;
  --accent:       #5BB8FF;   /* "observation blue" — links, active states */
  --signal-strong:#4ADE9C;   /* high confidence */
  --signal-mid:   #E8C45A;   /* uncertain */
  --signal-weak:  #F0856B;   /* weak / contested */
  --signal-unknown:#7C8AA5;  /* unknown — deliberately grey, never red (unknown ≠ wrong) */
  --contradiction:#FF5470;   /* reserved exclusively for contradictions */
}
:root[data-theme="light"] { /* inverted surface scale, same signal hues darkened ~15% */ }
```

Rule: the signal hues are **reserved for epistemics**. Decorative UI never uses green/amber/orange, so a glance at any page instantly separates interface from knowledge-state.

### 5.3 Typography

| Role | Face | Usage |
|---|---|---|
| Display | **Spectral** (serif, 300/500) | Page titles, the big questions — gives the metaphysical subject matter gravity without feeling antique |
| Body / UI | **Inter** (400/500/600) | All reading and interface text |
| Data | **IBM Plex Mono** (400/500) | Confidence scores, counts, timestamps, IDs — everything numeric reads as instrument output |

Type scale: 12 / 14 / 16 / 20 / 28 / 40 / 56px, line-height 1.6 body, 1.15 display. Eyebrow labels (domain names, status taxonomy) in 12px Plex Mono, uppercase, +0.08em tracking.

### 5.4 Layout & Components

- Max content width 1200px; data tables and the graph may go full-bleed.
- Cards: 1px `--border`, 8px radius, no shadows in dark mode (elevation via background step).
- **EpistemicBadge** — the five-level taxonomy as a small mono-type chip: `ESTABLISHED`, `STRONG EVIDENCE`, `PLAUSIBLE`, `SPECULATION`, `UNKNOWN`. Always visible on any card representing a claim. Never omitted, never restyled per page.
- **EvidenceBalance** — a two-column ledger (for / against) with per-item weight bars; the visual centerpiece of every hypothesis page.
- **ContradictionFlag** — `--contradiction` left border + icon; links to the contradiction record.
- Charts (Recharts): single-hue gradients from the signal palette, mono-type axes, no chart junk, dark grid lines at `--border`.
- Accessibility floor: visible focus rings (`--accent`, 2px offset), WCAG AA contrast on all signal colors against both surfaces, `prefers-reduced-motion` respected, full keyboard nav on graph and command palette.

### 5.5 Signature Element: The Confidence Meter

A horizontal instrument-style gauge used identically everywhere a confidence score appears: a 0–100 track with the five named bands ghosted underneath (Very Weak → Very Strong), a precise tick at the current value, the numeric value in Plex Mono, and an info affordance that reveals `confidence_rationale` plus a sparkline of `confidence_history`. Hovering shows the suggested-vs-assigned confidence delta when they diverge. This single component *is* the product's identity: knowledge rendered as instrumentation.

### 5.6 Motion

One orchestrated moment: on hypothesis pages, the Confidence Meter tick sweeps from 0 to its value on first view (600ms ease-out), and the evidence ledger rows stagger in (40ms apart). Everything else is instant. No ambient animation.

---

## 6. API Routes

All handlers validate with Zod, return `{ data, error }` envelopes, and use cursor pagination (`?cursor=&limit=`). Public GETs are cacheable; mutations require an admin session.

| Method & Path | Auth | Purpose |
|---|---|---|
| `GET /api/search?q=` | public | `global_search()` RPC across all node types |
| `GET /api/stats` | public | `dashboard_stats` materialized view |
| `GET /api/graph?domain=&depth=` | public | Nodes + edges JSON for the Research Graph (cached 1h) |
| `GET /api/hypotheses?domain=&status=&minConfidence=&sort=` | public | Filterable list |
| `POST /api/hypotheses` | admin | Create (Zod: title, description, domain, status, falsification criteria) |
| `GET/PATCH/DELETE /api/hypotheses/[id]` | public / admin / admin | Detail, update, retire (soft: `state='retired'`) |
| `POST/DELETE /api/hypotheses/[id]/evidence` | admin | Link/unlink evidence `{evidenceId, relation, weight, notes}` |
| `PATCH /api/hypotheses/[id]/confidence` | admin | `{value, rationale}` — returns suggested_confidence alongside |
| `GET/POST /api/evidence`, `GET/PATCH /api/evidence/[id]` | public/admin | Evidence library CRUD |
| `GET/POST /api/questions`, `…/[id]` | public/admin | Unanswered questions |
| `GET /api/timeline?cursor=&type=` | public | Timeline of Understanding feed |
| `GET/POST /api/simulations`, `POST /api/simulations/[id]/runs` | public/admin | Lab catalog + run records |
| `GET /api/contradictions`, `POST /api/contradictions/scan`, `PATCH /api/contradictions/[id]` | public/admin/admin | List, trigger scan, resolve |
| `POST /api/revalidate` | admin | Tag-based ISR revalidation after writes |

Design note: route handlers are deliberately thin — validation, auth, one query-layer call, revalidation. All epistemic logic lives in Postgres (§2.6–2.7) so future AI agents hitting the same API inherit identical guarantees.

---

## 7. Research Graph (V1.0 Implementation)

- **Data:** `/api/graph` returns `{nodes: [{id, type, label, status, confidence}], edges: [{from, to, type}]}` assembled from `graph_edges` plus implicit edges (hypothesis→domain, hypothesis→question, evidence links).
- **Rendering:** `d3-force` simulation drawn to `<canvas>` (perf headroom for thousands of nodes), SVG overlay for labels of focused nodes. Node color = epistemic signal hue; node shape by type (circle = hypothesis, diamond = question, square = evidence, ring = domain); edge style: solid = supports, dashed red = contradicts, dotted = related.
- **Interaction:** click → side panel with node summary + deep link; double-click → expand neighbors (`?depth=`); filter chips by domain/type; ⌘K search focuses a node.

---

## 8. Seed Content (ships with V1.0)

- 10 domains (per brief).
- ~20 canonical unanswered questions (something-from-nothing, consciousness, Big Bang origin, dark matter/energy, why laws exist, fine-tuning…).
- ~15 hypotheses spanning the taxonomy, including the brief's examples (reality fundamental vs. emergent, consciousness physical vs. non-reducible, information fundamental, spacetime emergent, mathematical universe) — each seeded with assumptions, falsification criteria, opposing evidence, and honest confidence scores in the *Uncertain* band or below. The seed data must model the epistemic standard: no seeded speculation above confidence 40.
- ~30 evidence entries from real, citable sources, linked both supportively and oppositionally so the contradiction engine and evidence ledger demonstrate non-trivially on day one.

---

## 9. Implementation Roadmap

### Phase 0 — Foundation (Week 1)
Repo, Next.js + TS + Tailwind scaffold, Supabase project, migration `0001_core.sql`, generated types, design tokens, fonts, root layout, nav/footer, deploy pipeline to Vercel (preview + production). **Exit:** empty shell live with dark theme.

### Phase 1 — Knowledge Core (Weeks 2–3)
Profiles/roles, RLS, auth flow, admin gate. Admin CRUD for domains, questions, hypotheses, evidence; evidence linker; confidence editor with mandatory rationale. Triggers verified (timeline + confidence history populate automatically). Seed data loaded. **Exit:** an admin can express a full epistemic record end-to-end.

### Phase 2 — Public Knowledge Surfaces (Weeks 4–5)
Home, domain pages, hypothesis database with filtering, hypothesis detail (EvidenceBalance, ConfidenceMeter, history sparkline, assumptions, falsification criteria), evidence library, unanswered questions, research notes. ISR + tag revalidation wired to writes. **Exit:** the public site fully represents the seeded knowledge map.

### Phase 3 — Instruments (Weeks 6–7)
Reality Dashboard (materialized view + Recharts), Timeline of Understanding, global search + ⌘K command palette, contradiction engine UI (scan trigger, review queue, visual flags on hypothesis pages). **Exit:** uncertainty and change-over-time are first-class, visible features.

### Phase 4 — Graph & Lab (Weeks 8–9)
Research Graph (canvas force layout, filtering, node expansion). Simulation Lab catalog: the five categories, simulation/run records, metrics charts from `simulation_runs.metrics`, artifact storage. V1.0 records and visualizes runs; executing simulations in-platform is V2. **Exit:** V1.0 feature-complete.

### Phase 5 — Hardening & Launch (Week 10)
Lighthouse ≥ 95 / a11y audit / mobile pass, SEO (metadata, OG images per hypothesis, sitemap), error & empty states, rate limiting on search, backup policy (Supabase PITR), analytics, content review against the epistemic standard. **Launch V1.0.**

### Post-1.0 horizon (architecture already supports)
1.1 researcher role + suggestion queue → 1.2 AI agent layer (agents authenticate as `actor_type='agent'`, write through the same audited API; Research/Contradiction agents first) → 1.3 in-platform simulation execution (Edge Functions/workers writing `simulation_runs`) → 1.4 public API + data exports (the open dataset of the map itself).

---

## 10. Invariants (the contract this architecture enforces)

1. No claim exists without an epistemic status; no status can exceed what its confidence permits (DB constraint).
2. No confidence changes without a recorded rationale (trigger).
3. History is append-only and automatic (security-definer triggers; no update/delete policies).
4. Public reads are safe by default (RLS); writes are triple-gated and attributed.
5. Unknown is rendered as grey, never as red: *not knowing is a state of the map, not an error.*
