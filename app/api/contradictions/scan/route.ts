import { apiData, apiError, requireAdmin } from "@/lib/api";
import { revalidateEntity } from "@/lib/revalidation";

/**
 * §6: trigger the §2.7 scan. Runs under the admin's session so the
 * security-definer function's internal guard also passes; idempotent thanks
 * to the contradictions unique constraint.
 */
export async function POST() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.supabase.rpc("scan_contradictions");
  if (error) return apiError(error.message, 500);

  revalidateEntity("contradiction");
  return apiData({ inserted: (data as number) ?? 0 });
}
