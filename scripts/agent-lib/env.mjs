// Shared env loader for the agent runner + ops scripts (plain Node ESM, kept
// out of the Next/tsc build on purpose). Real process.env always wins, so a
// shell override (e.g. VERITAS_LLM_MODEL=… AGENT_MAX_PROPOSALS=…) beats
// .env.local, mirroring lib/supabase/env.ts semantics.
import { readFileSync } from "node:fs";

export function loadEnv(path = ".env.local") {
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return; // no .env.local — rely on the real environment
  }
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const key = line.slice(0, i).trim();
    if (process.env[key] === undefined) process.env[key] = line.slice(i + 1).trim();
  }
}

export function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}
