import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiData, apiZodError } from "@/lib/api";
import { publicClient } from "@/lib/supabase/public";
import { listTimeline } from "@/lib/queries/timeline";
import type { TimelineEventType } from "@/types/domain";

const timelineQuerySchema = z.object({
  cursor: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  type: z
    .enum([
      "hypothesis_created",
      "hypothesis_updated",
      "hypothesis_status_changed",
      "evidence_added",
      "evidence_linked",
      "evidence_unlinked",
      "confidence_changed",
      "contradiction_detected",
      "contradiction_resolved",
      "question_added",
      "simulation_completed",
      "note_published",
    ])
    .optional(),
});

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const parsed = timelineQuerySchema.safeParse({
    cursor: sp.get("cursor") ?? undefined,
    limit: sp.get("limit") ?? undefined,
    type: sp.get("type") ?? undefined,
  });
  if (!parsed.success) return apiZodError(parsed.error);

  const page = await listTimeline(publicClient, {
    cursor: parsed.data.cursor,
    limit: parsed.data.limit,
    type: parsed.data.type as TimelineEventType | undefined,
  });
  return apiData(page);
}
