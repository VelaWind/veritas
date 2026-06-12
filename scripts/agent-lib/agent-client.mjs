// Transport for the agent runners.
//
// Least privilege: the runner holds ONLY the public anon key (for grounding
// context reads — exactly what a visitor can see) and a scoped agent bearer
// token (for proposing). It never touches the service-role key. Proposals go
// through the public HTTP route, so the runner exercises the same path a human
// contributor does.

/** Cookieless anon client for public reads (RLS applies — drafts stay hidden). */
export async function makeAnonClient(url, anonKey) {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** POST one suggestion to the agent propose endpoint with the scoped token. */
export async function propose(baseUrl, token, envelope) {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/agent/suggestions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(envelope),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON error body */
  }
  return {
    status: res.status,
    data: json?.data ?? null,
    error: json?.error ?? null,
  };
}
