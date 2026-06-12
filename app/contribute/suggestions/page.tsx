import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listSuggestions } from "@/lib/queries/suggestions";
import { MySuggestions } from "@/components/contribute/MySuggestions";

export const metadata = { title: "Contribute · My suggestions" };

export default async function MySuggestionsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/contribute/suggestions");

  // RLS already scopes to own rows; the explicit filter keeps an admin's view
  // here limited to what they personally proposed.
  const items = await listSuggestions(supabase, { mine: user.id });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-xl font-light text-ink">My suggestions</h1>
        <p className="mt-1 text-sm text-muted">
          Everything you&rsquo;ve proposed, and where it stands in review.
        </p>
      </div>
      <MySuggestions items={items} />
    </div>
  );
}
