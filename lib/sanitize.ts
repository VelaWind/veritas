/**
 * XSS guard for search snippets. Deliberately kept in its own module with ZERO
 * imports.
 *
 * Two reasons, both learned the hard way:
 *   1. It is the one piece of security-relevant string handling in this
 *      codebase, and it feeds `dangerouslySetInnerHTML`. It should be readable
 *      and reviewable without any surrounding context.
 *   2. It must be unit-testable by plain `node`, with no framework and no
 *      module resolver. It used to live in `lib/utils.ts`, which imports
 *      `@/lib/supabase/env` for the F-04 build guard — a path alias plain node
 *      cannot resolve, which made the function untestable in isolation
 *      (AUDIT.md F-02). Nothing may be imported here.
 *
 * Re-exported from `lib/utils.ts`, so both call sites are unchanged:
 *   app/(public)/search/page.tsx:80
 *   components/layout/CommandPalette.tsx:182
 *
 * Covered by `npm run test:unit` (scripts/test-sanitize.mjs).
 */

/**
 * Sanitize a Postgres ts_headline() snippet for safe rendering. ts_headline
 * wraps matches in <b>…</b> but does NOT escape the surrounding source text,
 * which is admin-authored markdown and could contain HTML. We escape the whole
 * string, then re-enable ONLY the bold highlight markers — so <script>,
 * <img onerror=…>, and event handlers are all rendered inert while the search
 * highlight still shows. Returns a string safe for dangerouslySetInnerHTML.
 *
 * ── THE `&` ESCAPE IS LOAD-BEARING, AND SO IS ITS POSITION. ────────────────
 * Two separate facts, both verified by deliberately breaking the function and
 * re-running scripts/test-sanitize.mjs:
 *
 *   1. `&` MUST be escaped AT ALL. Remove that first `.replace()` and source
 *      text containing the literal characters `&lt;b&gt;` sails through the
 *      escape pass untouched — and the re-enable step below then promotes that
 *      literal text into a REAL <b> tag. Measured: with the `&` escape removed,
 *      sanitizeHeadline("&lt;b&gt;not bold&lt;/b&gt;") returns
 *      "<b>not bold</b>". That is the classic escape-then-unescape hole, and it
 *      is a genuine escalation from displayed text to markup.
 *   2. `&` must be escaped FIRST. Escaping it last does NOT open the hole
 *      above — the literal still gets escaped, just later — but it double-
 *      escapes ts_headline's own markers (`&lt;b&gt;` → `&amp;lt;b&amp;gt;`),
 *      so the re-enable step matches nothing and the search highlight silently
 *      stops working. Measured: 7 assertions fail, including all three
 *      carve-out cases.
 *
 * So: omitting it is a security bug, moving it is a feature bug. Neither is
 * caught by anything except scripts/test-sanitize.mjs.
 *
 * ── APPLY EXACTLY ONCE. ────────────────────────────────────────────────────
 * Not idempotent, by design: the output is HTML, so feeding it back in
 * double-escapes it (`&lt;` → `&amp;lt;`). Both call sites apply it once, to
 * `r.snippet`, at the point of render. Do not pre-sanitize upstream.
 *
 * ── KNOWN LIMITATION: output may be unbalanced. ────────────────────────────
 * A literal `<b>` or `</b>` in the SOURCE text produces an unclosed or orphan
 * tag (`"<b>unclosed"` → `"<b>unclosed"`). Accepted, not a defect to fix:
 * cosmetic only, contained by the fragment parser at the container boundary,
 * and unreachable from ts_headline itself, which always emits balanced tags.
 * See AUDIT.md F-10.
 */
export function sanitizeHeadline(snippet: string): string {
  const escaped = snippet
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
  return escaped
    .replace(/&lt;b&gt;/g, "<b>")
    .replace(/&lt;\/b&gt;/g, "</b>");
}
