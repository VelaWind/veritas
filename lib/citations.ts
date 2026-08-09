import type { CitationStatus } from "@/types/domain";

/**
 * Citation resolution against Crossref and OpenAlex (§D.5a).
 *
 * Both are free, keyless, public APIs. Crossref asks that heavy users identify
 * themselves to get the "polite pool" — VERITAS_CROSSREF_MAILTO, optional.
 *
 * This runs SERVER-SIDE on purpose. If the runner resolved its own citations and
 * posted the verdict, a compromised or buggy agent could stamp every reference
 * `verified` and the badge would mean nothing. The agent supplies the citation
 * string; the server decides what it resolves to.
 *
 * No new dependency: plain fetch, and a token-overlap title score.
 */

const MAILTO = process.env.VERITAS_CROSSREF_MAILTO ?? "";
const UA = `Veritas/1.0 (https://github.com/; citation-verifier${MAILTO ? `; mailto:${MAILTO}` : ""})`;
const TIMEOUT_MS = 8000;

export interface CitationResult {
  citation_key: string;
  doi: string | null;
  url: string | null;
  claimed_title: string;
  status: CitationStatus;
  resolved_title: string | null;
  resolved_year: number | null;
  matched_via: string;
  score: number | null;
  source: string;
  raw: Record<string, unknown>;
}

const DOI_RE = /\b10\.\d{4,9}\/[-._;()/:a-z0-9]+/i;
const URL_RE = /https?:\/\/[^\s)>\]]+/i;

/** Strip a trailing '.' or ',' that a prose citation often leaves on a DOI. */
export function extractDoi(text: string): string | null {
  const m = text.match(DOI_RE);
  return m ? m[0].replace(/[.,;)]+$/, "").toLowerCase() : null;
}

export function extractUrl(text: string): string | null {
  const m = text.match(URL_RE);
  return m ? m[0].replace(/[.,;]+$/, "") : null;
}

/**
 * The primary key: a normalized DOI when there is one, else a normalized URL,
 * else the lowercased citation text. Keying on the citation rather than on a
 * suggestion or evidence row is what lets a result survive approval without
 * apply_suggestion() having to carry it (§D.5a).
 */
export function citationKey(text: string): string {
  const doi = extractDoi(text);
  if (doi) return `doi:${doi}`;
  const url = extractUrl(text);
  if (url) {
    try {
      const u = new URL(url);
      return `url:${u.host.toLowerCase()}${u.pathname.replace(/\/$/, "")}`;
    } catch {
      return `url:${url.toLowerCase()}`;
    }
  }
  return `text:${text.trim().toLowerCase().slice(0, 200)}`;
}

/**
 * The same key, derived from a stored `sources` row rather than a citation
 * string. This is what lets a check made against a PROPOSAL be found again from
 * the approved evidence page: both sides compute the key from the DOI/URL they
 * hold, so nothing has to be carried across approval (§D.5a).
 */
export function sourceCitationKey(
  doi: string | null | undefined,
  url: string | null | undefined,
): string | null {
  if (doi && doi.trim()) return `doi:${doi.trim().replace(/^https?:\/\/doi\.org\//i, "").toLowerCase()}`;
  if (url && url.trim()) return citationKey(url.trim());
  return null;
}

const STOP = new Set(["the", "a", "an", "of", "and", "or", "in", "on", "for", "to", "with"]);

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOP.has(t)),
  );
}

/** Dice coefficient over content tokens. Cheap, dependency-free, good enough. */
export function titleScore(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return (2 * shared) / (ta.size + tb.size);
}

async function getJson(url: string): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": UA },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    // Network failure, timeout, or malformed JSON. Indistinguishable from "not
    // indexed" for our purposes, and both mean `unresolved` — a flag, never a
    // rejection.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Thresholds: a DOI that resolves to a clearly different paper is a mismatch. */
const DOI_MATCH_FLOOR = 0.5;
const TITLE_MATCH_FLOOR = 0.8;

export async function resolveCitation(
  citation: string,
  claimedTitle = "",
): Promise<CitationResult> {
  const doi = extractDoi(citation);
  const url = extractUrl(citation);
  const base: CitationResult = {
    citation_key: citationKey(citation),
    doi,
    url,
    claimed_title: claimedTitle,
    status: "unresolved",
    resolved_title: null,
    resolved_year: null,
    matched_via: "",
    score: null,
    source: "",
    raw: {},
  };

  if (doi) {
    const cr = await getJson(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
    const msg = cr?.message as Record<string, unknown> | undefined;
    if (msg) {
      const title = Array.isArray(msg.title) ? String(msg.title[0] ?? "") : "";
      const year = (msg.issued as { "date-parts"?: number[][] } | undefined)?.["date-parts"]?.[0]?.[0];
      const score = claimedTitle && title ? titleScore(claimedTitle, title) : null;
      return {
        ...base,
        // With no claimed title there is nothing to contradict, so a resolving
        // DOI is verified on its own.
        status: score === null || score >= DOI_MATCH_FLOOR ? "verified" : "mismatch",
        resolved_title: title || null,
        resolved_year: typeof year === "number" ? year : null,
        matched_via: "doi",
        score,
        source: "crossref",
        raw: { title, year },
      };
    }

    const oa = await getJson(`https://api.openalex.org/works/doi:${encodeURIComponent(doi)}`);
    if (oa && typeof oa.id === "string") {
      const title = String(oa.display_name ?? "");
      const year = typeof oa.publication_year === "number" ? oa.publication_year : null;
      const score = claimedTitle && title ? titleScore(claimedTitle, title) : null;
      return {
        ...base,
        status: score === null || score >= DOI_MATCH_FLOOR ? "verified" : "mismatch",
        resolved_title: title || null,
        resolved_year: year,
        matched_via: "doi",
        score,
        source: "openalex",
        raw: { title, year },
      };
    }
    // A DOI that resolves nowhere is unresolved, not a mismatch: it may simply
    // be outside both indexes.
    return base;
  }

  // No DOI — fall back to a bibliographic search on whatever text we have.
  const query = (claimedTitle || citation).slice(0, 300);
  const cr = await getJson(
    `https://api.crossref.org/works?rows=3&select=title,issued,DOI&query.bibliographic=${encodeURIComponent(query)}`,
  );
  const items = ((cr?.message as { items?: unknown[] } | undefined)?.items ?? []) as Array<
    Record<string, unknown>
  >;
  let best: { title: string; year: number | null; doi: string | null; score: number } | null = null;
  for (const it of items) {
    const title = Array.isArray(it.title) ? String(it.title[0] ?? "") : "";
    if (!title) continue;
    const score = titleScore(query, title);
    if (!best || score > best.score) {
      const year = (it.issued as { "date-parts"?: number[][] } | undefined)?.["date-parts"]?.[0]?.[0];
      best = {
        title,
        year: typeof year === "number" ? year : null,
        doi: typeof it.DOI === "string" ? it.DOI.toLowerCase() : null,
        score,
      };
    }
  }

  if (best && best.score >= TITLE_MATCH_FLOOR) {
    return {
      ...base,
      doi: best.doi,
      status: "verified",
      resolved_title: best.title,
      resolved_year: best.year,
      matched_via: "title",
      score: best.score,
      source: "crossref",
      raw: { title: best.title, year: best.year },
    };
  }

  return {
    ...base,
    status: "unresolved",
    matched_via: best ? "title" : "",
    score: best?.score ?? null,
    source: best ? "crossref" : "",
    raw: best ? { best_title: best.title, below_threshold: true } : {},
  };
}
