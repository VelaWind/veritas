import { createClient } from "@/lib/supabase/server";
import { listContradictions } from "@/lib/queries/contradictions";
import { ContradictionQueue } from "@/components/admin/ContradictionQueue";
import { ScanContradictionsButton } from "@/components/admin/ActionButtons";

export const metadata = { title: "Admin · Contradictions" };

export default async function AdminContradictionsPage() {
  const supabase = await createClient();
  const items = await listContradictions(supabase);
  const open = items.filter((c) => !c.resolved);
  const resolved = items.filter((c) => c.resolved);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-light text-ink">
            Contradiction review queue
          </h1>
          <p className="mt-1 text-sm text-muted">
            {open.length} open · {resolved.length} resolved
          </p>
        </div>
        <ScanContradictionsButton />
      </div>

      <ContradictionQueue items={[...open, ...resolved]} />
    </div>
  );
}
