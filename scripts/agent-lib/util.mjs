// Small shared helpers for the agent runners.

/** Slugify to the project's rule: lowercase letters/digits/hyphens, 2–80 chars. */
export function slugify(text, fallback = "agent-proposal") {
  let s = String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (s.length > 70) s = s.slice(0, 70).replace(/-+$/g, "");
  return s.length >= 2 ? s : fallback;
}

/** Make `slug` unique against a Set of taken slugs by appending -2, -3, … */
export function uniquify(slug, taken) {
  if (!taken.has(slug)) {
    taken.add(slug);
    return slug;
  }
  for (let i = 2; i < 1000; i++) {
    const candidate = `${slug}-${i}`.slice(0, 80).replace(/-+$/g, "");
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
  taken.add(slug);
  return slug;
}

/**
 * Tolerant JSON extraction from a model response: strips ```json fences, then
 * takes the outermost {...}, with a trailing-comma repair fallback. Returns the
 * parsed object or null.
 */
export function extractJson(text) {
  if (!text) return null;
  let t = String(text).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  const slice = t.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch {
    /* try repair */
  }
  try {
    return JSON.parse(slice.replace(/,\s*([}\]])/g, "$1"));
  } catch {
    return null;
  }
}

/** A short, stable-ish string fingerprint for dedupe (lowercased alnum words). */
export function titleKey(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 12)
    .join(" ");
}
