import { createClient } from "@/lib/supabase/server";
import { listSuggestions } from "@/lib/queries/suggestions";
import { SuggestionQueue } from "@/components/admin/SuggestionQueue";

export const metadata = { title: "Admin · Suggestions" };

export default async function AdminSuggestionsPage() {
  const supabase = await createClient();
  const all = await listSuggestions(supabase);
  const pending = all.filter((s) => s.status === "pending");
  const decided = all.filter((s) => s.status !== "pending");

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-xl font-light text-ink">Suggestion queue</h1>
        <p className="mt-1 text-sm text-muted">
          {pending.length} pending · {decided.length} decided. Approving applies
          the change through the same epistemic guards as a direct admin write.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="eyebrow">Pending review</h2>
        <SuggestionQueue items={pending} />
      </section>

      {decided.length > 0 && (
        <section className="space-y-3">
          <h2 className="eyebrow">Decided</h2>
          <SuggestionQueue items={decided} />
        </section>
      )}
    </div>
  );
}
