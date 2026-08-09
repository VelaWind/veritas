/**
 * Central env access with safe placeholders so `next build` (which prerenders
 * ISR pages) succeeds without live credentials. Real values always win.
 */
export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://placeholder.supabase.co";

export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "placeholder-anon-key";

export const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? "placeholder-service-role-key";

export const HAS_LIVE_SUPABASE =
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
  !process.env.NEXT_PUBLIC_SUPABASE_URL?.includes("placeholder");

/**
 * Is this a *production* build or production server — as opposed to local dev,
 * a preview deploy, or a credential-free local `next build`?
 *
 * On Vercel, `VERCEL_ENV` is the only honest signal: `next build` sets
 * NODE_ENV=production for preview and production deploys alike, so NODE_ENV
 * cannot distinguish them. Off Vercel there is no VERCEL_ENV, so we fall back
 * to NODE_ENV — but only outside the build phase. `next build` always sets
 * NODE_ENV=production, including the credential-free local build that this
 * file's placeholders exist to support; NEXT_PHASE lets us exempt it while
 * still catching a self-hosted `next start` running on placeholders.
 */
const IS_PRODUCTION =
  process.env.VERCEL_ENV === "production" ||
  (!process.env.VERCEL &&
    process.env.NODE_ENV === "production" &&
    process.env.NEXT_PHASE !== "phase-production-build");

/**
 * Refuse to build or serve production against placeholder credentials.
 *
 * This is the fix for a two-month outage: every page returned HTTP 200 and
 * rendered its empty state while the database was unreachable, because
 * NEXT_PUBLIC_SUPABASE_URL fell through to the placeholder host below and
 * every fetch failed at DNS. The placeholder is deliberate and stays — it is
 * what lets local dev and preview builds work with no credentials at all —
 * but it must never reach production.
 *
 * THE TRAP, named so the next person recognises it: the variable had been
 * marked **"Sensitive" in Vercel's environment-variable settings**. A
 * NEXT_PUBLIC_* value must be inlined into the client bundle at build time,
 * which is precisely what the Sensitive flag prevents. The variable looks
 * present and correct in the Vercel dashboard; it simply is not readable by
 * the build. If you are reading this message, check that flag first.
 *
 * Server-only (`typeof window === "undefined"`): this module is imported by
 * lib/supabase/client.ts, which is browser code. A bare NODE_ENV check at
 * module load could otherwise throw in a visitor's browser rather than in the
 * build. It cannot fire on a correctly configured deploy — but "cannot" is
 * worth more than "should not".
 */
if (typeof window === "undefined" && IS_PRODUCTION && !HAS_LIVE_SUPABASE) {
  throw new Error(
    [
      "Refusing to build production against placeholder Supabase credentials.",
      "",
      `NEXT_PUBLIC_SUPABASE_URL resolved to "${SUPABASE_URL}", which is the`,
      "build-time placeholder, not a real project. That host does not resolve,",
      "so every query would fail at the network layer and every page would",
      "render its empty state while returning HTTP 200. This has happened",
      "before and went unnoticed for two months.",
      "",
      "Most likely cause: NEXT_PUBLIC_SUPABASE_URL is marked *Sensitive* in",
      "Vercel's environment variables. NEXT_PUBLIC_* values must be inlined",
      "into the bundle at build time, which the Sensitive flag prevents — so",
      "the value reads as present in the dashboard but is empty during the",
      "build. Uncheck Sensitive for NEXT_PUBLIC_SUPABASE_URL and",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY, then redeploy.",
      "",
      "Otherwise: the variable is missing from this environment, or is not",
      "exposed to the Production environment in the project settings.",
      "",
      "Local development and preview builds are unaffected and still run with",
      "no credentials at all — this check applies only to production.",
    ].join("\n"),
  );
}
