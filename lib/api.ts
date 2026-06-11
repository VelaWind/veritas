import { NextResponse } from "next/server";
import type { ZodError } from "zod";
import { createClient } from "@/lib/supabase/server";

/** §6: every handler returns a `{ data, error }` envelope. */
export function apiData<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ data, error: null }, init);
}

export function apiError(error: string, status = 400) {
  return NextResponse.json({ data: null, error }, { status });
}

export function apiZodError(err: ZodError) {
  const detail = err.issues
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  return apiError(`Validation failed — ${detail}`, 422);
}

/**
 * Auth gate 2 of §4.2 (the handler role check; middleware is gate 1, RLS is
 * gate 3). Returns a session-bound client so the subsequent write runs under
 * the admin's JWT and is attributed in the audit trail.
 */
export async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false as const, response: apiError("Authentication required.", 401) };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "admin") {
    return { ok: false as const, response: apiError("Admin role required.", 403) };
  }

  return { ok: true as const, supabase, user };
}

/** Friendly translation of the DB epistemic-guard errors (§2.3/§2.6). */
export function translateDbError(message: string): string {
  if (message.includes("epistemics_consistent")) {
    return "Rejected by the database epistemic guard: that confidence is outside the permitted band for the chosen status.";
  }
  if (message.includes("rationale")) {
    return message; // trigger messages are already human-readable
  }
  if (message.includes("duplicate key")) {
    return "A record with that identifier (slug or link) already exists.";
  }
  return message;
}
