-- ═══════════════════════════════════════════════════════════════════════════
-- VERITAS — 0005_agent_role.sql   (Post-1.0 Phase B, stage 1a)
--
-- Adds the 'agent' value to the user_role enum, ALONE, in its own migration.
-- Postgres forbids using a freshly-added enum value in the same transaction
-- that adds it; supabase db push applies each migration file separately, so
-- isolating the ALTER TYPE here guarantees 'agent' is committed before 0006
-- (and the mint script) ever coerce a value to it. 0006 additionally compares
-- role::text rather than the enum literal, so it is safe regardless of how the
-- push batches transactions (belt and suspenders).
--
-- Idempotent: IF NOT EXISTS makes a re-run a no-op.
-- ═══════════════════════════════════════════════════════════════════════════

alter type user_role add value if not exists 'agent';
