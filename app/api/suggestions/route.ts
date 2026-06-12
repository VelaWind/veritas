import type { NextRequest } from "next/server";
import {
  apiData,
  apiError,
  apiZodError,
  requireContributor,
  translateDbError,
} from "@/lib/api";
import { listSuggestions } from "@/lib/queries/suggestions";
import {
  SUGGESTION_PAYLOAD_SCHEMAS,
  suggestionEnvelopeSchema,
} from "@/lib/validations";
import type { SuggestionStatus } from "@/types/domain";

const STATUSES: SuggestionStatus[] = ["pending", "approved", "rejected", "withdrawn"];

/**
 * §Phase A: the suggestion queue. Contributors (researcher|admin) read their
 * own suggestions; admins read all (RLS enforces the scoping regardless of
 * the query). Filters: ?status=&mine=true.
 */
export async function GET(request: NextRequest) {
  const auth = await requireContributor();
  if (!auth.ok) return auth.response;

  const sp = request.nextUrl.searchParams;
  const statusRaw = sp.get("status");
  if (statusRaw && !STATUSES.includes(statusRaw as SuggestionStatus)) {
    return apiError("Invalid status filter.", 422);
  }
  const mine = sp.get("mine") === "true";

  const rows = await listSuggestions(auth.supabase, {
    status: (statusRaw as SuggestionStatus | null) ?? undefined,
    mine: mine ? auth.user.id : undefined,
  });
  return apiData(rows);
}

/**
 * Propose a create/edit into the queue. The envelope is validated, then the
 * payload is re-validated against the SAME create/edit schema the admin forms
 * use. The row is attributed to the caller and forced to status='pending' by
 * RLS — a contributor can never write directly to the knowledge tables.
 */
export async function POST(request: NextRequest) {
  const auth = await requireContributor();
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON body.", 400);
  }

  const env = suggestionEnvelopeSchema.safeParse(body);
  if (!env.success) return apiZodError(env.error);

  const { target_type, operation, target_id, payload, rationale } = env.data;
  const payloadSchema = SUGGESTION_PAYLOAD_SCHEMAS[target_type][operation];
  const parsedPayload = payloadSchema.safeParse(payload);
  if (!parsedPayload.success) return apiZodError(parsedPayload.error);

  const { data, error } = await auth.supabase
    .from("suggestions")
    .insert({
      target_type,
      operation,
      target_id: target_id ?? null,
      payload: parsedPayload.data,
      rationale,
      proposed_by: auth.user.id,
      actor_type: "human",
    })
    .select()
    .single();

  if (error) return apiError(translateDbError(error.message), 409);
  return apiData(data, { status: 201 });
}
