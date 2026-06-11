"use client";

import type { ApiEnvelope } from "@/types/domain";

/** Thin fetch wrapper for the §6 `{ data, error }` envelope. Client-side only. */
async function call<T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  body?: unknown,
): Promise<ApiEnvelope<T>> {
  try {
    const res = await fetch(url, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json()) as ApiEnvelope<T>;
    if (!res.ok && !json.error) {
      return { data: null, error: `Request failed (${res.status})` };
    }
    return json;
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : "Network error",
    };
  }
}

export const api = {
  get: <T>(url: string) => call<T>("GET", url),
  post: <T>(url: string, body?: unknown) => call<T>("POST", url, body),
  patch: <T>(url: string, body?: unknown) => call<T>("PATCH", url, body),
  delete: <T>(url: string, body?: unknown) => call<T>("DELETE", url, body),
};
