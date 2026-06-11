// One-off diagnostic: compares anon vs service-role reads to locate the bug.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const anon = createClient(url, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});
const admin = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function show(label, { data, error, count }) {
  if (error) {
    console.log(`✗ ${label}: ERROR ${error.code ?? ""} — ${error.message}`);
    if (error.details) console.log(`    details: ${error.details}`);
    if (error.hint) console.log(`    hint: ${error.hint}`);
  } else {
    console.log(`✓ ${label}: ${count ?? data?.length ?? 0} rows`);
  }
}

console.log("URL:", url, "\n");

// 1. service role: ground truth
show(
  "service-role  hypotheses count",
  await admin.from("hypotheses").select("*", { count: "exact", head: true }),
);
show(
  "service-role  active hypotheses",
  await admin.from("hypotheses").select("id, state").eq("state", "active"),
);

// 2. anon: the failing path — plain select
show(
  "anon          hypotheses (plain)",
  await anon.from("hypotheses").select("id, slug, state"),
);

// 3. anon: with the domain embed exactly as listHypotheses does
show(
  "anon          hypotheses + domain embed",
  await anon.from("hypotheses").select("*, domain:domains(id, slug, name)").neq("state", "draft"),
);

// 4. anon: other public tables
for (const t of ["domains", "questions", "evidence", "simulations", "research_notes"]) {
  show(`anon          ${t}`, await anon.from(t).select("id"));
}

// 5. anon: is_admin() RPC
try {
  const r = await anon.rpc("is_admin");
  show("anon          is_admin() rpc", r);
  if (!r.error) console.log("    is_admin() returned:", JSON.stringify(r.data));
} catch (e) {
  console.log("✗ anon is_admin() threw:", e.message);
}
