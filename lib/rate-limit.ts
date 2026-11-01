/**
 * Rate limiting for public endpoints, shared across serverless instances.
 *
 * The count lives in Postgres (`rate_limit_hit()`, migration 0016): one atomic
 * upsert both records the hit and decides, so every instance sees the same
 * count. When that store cannot answer (the migration is not applied yet, the
 * database errors, no service-role key), the decision falls back to the
 * per-instance in-memory count this module used to be. That keeps the old soft
 * control rather than none, and a database fault never blocks a search.
 *
 * Zero imports on purpose, so `scripts/test-rate-limit.mjs` can load it with
 * plain Node: the store is passed in, not constructed here.
 */

export interface RateLimitPolicy {
  windowMs: number;
  max: number;
}

/**
 * Records one hit for `bucket` and resolves true when it is over the limit.
 * Resolves null when the shared store cannot answer, which selects the
 * in-memory fallback.
 */
export type SharedStore = (bucket: string, policy: RateLimitPolicy) => Promise<boolean | null>;

export type LimitSource = "shared" | "memory";

/** The in-memory limiter, unchanged in behaviour: per instance, window opens at the first hit. */
export function createMemoryLimiter(policy: RateLimitPolicy, now: () => number = Date.now) {
  const hits = new Map<string, { count: number; windowStart: number }>();
  return function limited(bucket: string): boolean {
    const t = now();
    const entry = hits.get(bucket);
    if (!entry || t - entry.windowStart > policy.windowMs) {
      hits.set(bucket, { count: 1, windowStart: t });
      return false;
    }
    entry.count += 1;
    if (hits.size > 10_000) hits.clear(); // unbounded-growth guard
    return entry.count > policy.max;
  };
}

/**
 * The limiter a route calls. Asks the shared store first; uses the in-memory
 * count only when the store resolves null or throws. `onFallback` is told why,
 * so the route can log it: a silent fallback would hide a missing migration.
 */
export function createRateLimiter(opts: {
  policy: RateLimitPolicy;
  store: SharedStore;
  onFallback?: (reason: string) => void;
  now?: () => number;
}) {
  const memory = createMemoryLimiter(opts.policy, opts.now);
  return async function check(bucket: string): Promise<{ limited: boolean; source: LimitSource }> {
    let shared: boolean | null = null;
    try {
      shared = await opts.store(bucket, opts.policy);
    } catch (err) {
      opts.onFallback?.(err instanceof Error ? err.message : String(err));
    }
    if (shared === null) {
      return { limited: memory(bucket), source: "memory" };
    }
    return { limited: shared, source: "shared" };
  };
}

/**
 * The bucket for a client address: a SHA-256 hex digest, so the table never
 * holds an address. `digest` is injected (Web Crypto in the route) to keep this
 * module import-free.
 */
export async function bucketFor(
  scope: string,
  address: string,
  digest: (text: string) => Promise<string>,
): Promise<string> {
  return `${scope}:${await digest(address)}`;
}
