import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { IS_PRODUCTION } from "@/lib/supabase/env";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Fixed locale + explicit options so server and client render identically. */
export function formatDate(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatDateTime(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return `${formatDate(d)} ${d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  })} UTC`;
}

export function timeAgo(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

export function truncate(text: string, length: number): string {
  if (text.length <= length) return text;
  return `${text.slice(0, length).trimEnd()}…`;
}

/** Strip markdown syntax for plain-text contexts (cards, OG descriptions). */
export function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_~>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Canonical site URL. Feeds `sitemap.xml`, `robots.txt`, `metadataBase`, and
 * per-hypothesis OpenGraph URLs — all of which are baked at build time.
 *
 * `.trim()` and `||` rather than `??`: an env var set to an empty string is
 * "present" as far as `??` is concerned, so the old form let `""` through and
 * `new URL("")` then threw somewhere far less legible than here.
 */
const RAW_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL?.trim();

export const SITE_URL = RAW_SITE_URL || "http://localhost:3000";

/** Unset, blank, or still pointing at a dev host. */
const SITE_URL_IS_NOT_PRODUCTION =
  !RAW_SITE_URL || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(RAW_SITE_URL);

/**
 * Refuse to build production with a localhost canonical URL (AUDIT.md F-04).
 *
 * Same shape, and the same production test, as the credential guard in
 * `lib/supabase/env.ts` — `IS_PRODUCTION` is imported from there rather than
 * re-derived, so the two guards can never disagree about what "production"
 * means. That matters more than it looks: `VERCEL_ENV` is the only honest
 * signal on Vercel, and `NEXT_PHASE` is what exempts the credential-free local
 * build. A hand-rolled second copy would drift.
 *
 * Why this needs a guard at all: unlike a bad database URL, this one is
 * completely silent. Every page still renders, every query still works, the
 * build succeeds — and `sitemap.xml`, `robots.txt` and every OG tag ship
 * pointing at `http://localhost:3000`. Search engines and social unfurlers are
 * the only things that notice, and they do not report back. It is the same
 * failure shape as the outage that produced the guard below: a wrong value
 * producing a plausible-looking success.
 *
 * These values are inlined at build time, so a wrong one cannot be corrected at
 * runtime — only a rebuild fixes it. Failing the build is the only place this
 * can be caught.
 *
 * Server-only, for the same reason as the credential guard: this module is
 * imported by client components (`cn` is used almost everywhere), and an
 * unguarded module-load throw would fire in a visitor's browser instead of in
 * the build.
 */
if (typeof window === "undefined" && IS_PRODUCTION && SITE_URL_IS_NOT_PRODUCTION) {
  throw new Error(
    [
      "Refusing to build production with a non-production NEXT_PUBLIC_SITE_URL.",
      "",
      RAW_SITE_URL
        ? `NEXT_PUBLIC_SITE_URL is "${RAW_SITE_URL}", which is a local dev host.`
        : 'NEXT_PUBLIC_SITE_URL is unset or empty, so it fell back to the\ndevelopment default "http://localhost:3000".',
      "",
      "This value is baked into sitemap.xml, robots.txt, metadataBase and every",
      "OpenGraph URL at build time. Shipping it would publish a sitemap full of",
      "localhost links and OG tags that unfurl to nothing — silently, because",
      "the site itself renders perfectly and nothing logs an error.",
      "",
      "Set NEXT_PUBLIC_SITE_URL to the canonical origin for this deployment",
      "(e.g. https://veritas-delta-pearl.vercel.app) and rebuild. NEXT_PUBLIC_*",
      "values are inlined at build time, so this cannot be corrected at runtime.",
      "",
      "Local development and preview builds are unaffected — this check applies",
      "only to production.",
    ].join("\n"),
  );
}

/**
 * Re-export, so both call sites keep importing `sanitizeHeadline` from
 * `@/lib/utils` and nothing about them changes.
 *
 * The implementation lives in `lib/sanitize.ts` because that module has ZERO
 * imports and this one does not: `lib/utils.ts` imports `@/lib/supabase/env`
 * for the F-04 guard above, and plain `node` cannot resolve that path alias —
 * which made the XSS guard impossible to unit-test in isolation. See
 * `lib/sanitize.ts` for the escape-order and once-only contracts.
 */
export { sanitizeHeadline } from "@/lib/sanitize";
