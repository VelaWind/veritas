// Citation-verifier client (DECISIONS §D.5a).
//
// The runner sends citation STRINGS and the SERVER resolves them against
// Crossref and OpenAlex. Deliberately thin: no resolution logic lives here,
// because a runner that decided its own verdicts could stamp everything
// `verified` and the badge would mean nothing. See lib/citations.ts.
//
// Costs no model calls — these are plain HTTP lookups against free, keyless
// APIs — so citation checking is NOT charged against the run's model budget.

export async function verifyCitations(baseUrl, token, citations) {
  const payload = citations
    .filter((c) => c && String(c.citation ?? "").trim().length >= 3)
    .slice(0, 20)
    .map((c) => ({
      citation: String(c.citation).trim().slice(0, 1000),
      claimed_title: String(c.claimed_title ?? "").trim().slice(0, 500),
    }));
  if (payload.length === 0) return { ok: true, results: [] };

  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/agent/citations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ citations: payload }),
    });
    let json = null;
    try {
      json = await res.json();
    } catch {
      /* non-JSON error body */
    }
    if (res.status !== 200) {
      return { ok: false, error: json?.error ?? `HTTP ${res.status}`, results: [] };
    }
    return { ok: true, results: json?.data ?? [] };
  } catch (err) {
    // A citation lookup failing must never abort a research run: the result is
    // a missing badge, not a lost proposal.
    return { ok: false, error: String(err.message ?? err), results: [] };
  }
}

/** One-line summary for the runner's console output. */
export function summarizeCitations(results) {
  if (!results.length) return "no citations";
  const by = { verified: 0, unresolved: 0, mismatch: 0 };
  for (const r of results) by[r.status] = (by[r.status] ?? 0) + 1;
  return `${by.verified} verified · ${by.unresolved} unresolved · ${by.mismatch} mismatch`;
}
