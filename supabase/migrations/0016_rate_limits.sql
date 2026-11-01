-- ═══════════════════════════════════════════════════════════════════════════
-- VERITAS: 0016_rate_limits.sql   (README Known limits: the search rate limiter)
--
-- A rate limit that holds across serverless instances. /api/search counted
-- requests in a Map inside one function instance, so each instance had its own
-- count and the limit multiplied with the number of instances. The count now
-- lives in one table, and one function both counts a hit and answers whether
-- the caller is over the limit, in a single atomic statement.
--
-- SEMANTICS ARE THE IN-MEMORY LIMITER'S. A window opens at a bucket's first hit
-- and lasts p_window_seconds; within it every call adds one; the call that
-- takes the count past p_max, and every call after it, is limited; the first
-- call after the window ends opens a new window at 1.
--
-- WHY ONE STATEMENT. `insert ... on conflict (bucket) do update` takes the row
-- lock and computes the new count from the locked row, so two concurrent calls
-- for the same bucket are serialized by Postgres and cannot both read the old
-- count. A select-then-update pair would let N simultaneous requests all see
-- the same count and all pass. Every SET expression reads the OLD row, which is
-- why `window_start` and `hits` can each test the old window independently.
--
-- WHO MAY CALL IT. service_role only. If anon held EXECUTE, any visitor could
-- call it directly with another caller's bucket and lock that caller out, or
-- fill the table with invented buckets. The route calls it server-side with the
-- service-role client; the table has RLS on and no grants to anon or
-- authenticated, so the function is the only path to it.
--
-- WHAT IS STORED. The route passes a SHA-256 hash of the client address, never
-- the address. Rows untouched for an hour are deleted by the function itself,
-- on roughly one call in fifty, so the table stays the size of recent traffic
-- without a scheduled job.
--
-- Depends on 0009 (which closed the default that granted anon rights on new
-- tables) and 0012 (which closed it for new functions); the grants below are
-- explicit anyway. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists rate_limit_hits (
  bucket        text        primary key check (length(bucket) between 1 and 200),
  window_start  timestamptz not null,
  hits          integer     not null check (hits >= 1)
);

create index if not exists rate_limit_hits_window_start_idx
  on rate_limit_hits (window_start);

alter table rate_limit_hits enable row level security;
-- No policies: nothing but the definer function below reads or writes rows.
revoke all on rate_limit_hits from anon, authenticated;

/**
 * Counts one hit for p_bucket and returns true when the caller is over the
 * limit (more than p_max hits in the current window of p_window_seconds).
 */
create or replace function rate_limit_hit(
  p_bucket         text,
  p_window_seconds integer,
  p_max            integer
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_now  timestamptz := clock_timestamp();
  v_from timestamptz;
  v_hits integer;
begin
  if p_bucket is null or length(p_bucket) not between 1 and 200 then
    raise exception 'rate_limit_hit: bucket must be 1 to 200 characters.' using errcode = '22023';
  end if;
  if p_window_seconds is null or p_window_seconds < 1 or p_max is null or p_max < 1 then
    raise exception 'rate_limit_hit: window and max must be positive.' using errcode = '22023';
  end if;

  v_from := v_now - make_interval(secs => p_window_seconds);

  insert into rate_limit_hits as r (bucket, window_start, hits)
  values (p_bucket, v_now, 1)
  on conflict (bucket) do update set
    hits         = case when r.window_start >= v_from then r.hits + 1 else 1 end,
    window_start = case when r.window_start >= v_from then r.window_start else v_now end
  returning hits into v_hits;

  -- Amortized cleanup: about one call in fifty prunes buckets idle for an hour.
  if random() < 0.02 then
    delete from rate_limit_hits where window_start < v_now - interval '1 hour';
  end if;

  return v_hits > p_max;
end $$;

revoke execute on function rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function rate_limit_hit(text, integer, integer) to service_role;


-- ── Verification: each guard asserts a promise made above ─────────────────
--
-- 1. The window semantics: with p_max 2, calls one and two pass and call three
--    is limited; a window of the past opens fresh at 1.
-- 2. anon and authenticated can neither execute the function nor touch the
--    table; service_role can execute it. RLS is on.
-- The probe bucket is removed afterwards.
do $$
declare
  v_msg    text := '';
  v_bucket text := 'migration-0016-probe';
  a boolean; b boolean; c boolean; d boolean;
begin
  delete from rate_limit_hits where bucket = v_bucket;
  a := rate_limit_hit(v_bucket, 60, 2);
  b := rate_limit_hit(v_bucket, 60, 2);
  c := rate_limit_hit(v_bucket, 60, 2);
  if a or b or not c then
    v_msg := v_msg || format('expected pass, pass, limited; got %s, %s, %s; ', a, b, c);
  end if;
  update rate_limit_hits set window_start = clock_timestamp() - interval '2 minutes' where bucket = v_bucket;
  d := rate_limit_hit(v_bucket, 60, 2);
  if d or (select hits from rate_limit_hits where bucket = v_bucket) <> 1 then
    v_msg := v_msg || 'an expired window did not reopen at 1; ';
  end if;
  delete from rate_limit_hits where bucket = v_bucket;

  if has_function_privilege('anon', 'public.rate_limit_hit(text,integer,integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.rate_limit_hit(text,integer,integer)', 'EXECUTE') then
    v_msg := v_msg || 'anon or authenticated can execute rate_limit_hit; ';
  end if;
  if not has_function_privilege('service_role', 'public.rate_limit_hit(text,integer,integer)', 'EXECUTE') then
    v_msg := v_msg || 'service_role cannot execute rate_limit_hit; ';
  end if;
  if has_table_privilege('anon', 'public.rate_limit_hits', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', 'public.rate_limit_hits', 'SELECT,INSERT,UPDATE,DELETE') then
    v_msg := v_msg || 'anon or authenticated holds a privilege on rate_limit_hits; ';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.rate_limit_hits'::regclass) then
    v_msg := v_msg || 'RLS is off on rate_limit_hits; ';
  end if;

  if v_msg <> '' then
    raise exception 'rate limit guard: %Refusing to apply.', v_msg;
  end if;
  raise notice 'rate limit: window semantics hold; only service_role can execute; table closed to anon and authenticated.';
end $$;
