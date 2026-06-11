import type { NextRequest } from "next/server";
import { apiData } from "@/lib/api";
import { publicClient } from "@/lib/supabase/public";
import { listContradictions } from "@/lib/queries/contradictions";

export async function GET(request: NextRequest) {
  const resolvedParam = request.nextUrl.searchParams.get("resolved");
  const resolved =
    resolvedParam === "true" ? true : resolvedParam === "false" ? false : undefined;

  const rows = await listContradictions(publicClient, { resolved });
  return apiData(rows);
}
