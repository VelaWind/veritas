import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { listNotes } from "@/lib/queries/notes";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Admin · Notes" };

export default async function AdminNotesPage() {
  const supabase = await createClient();
  const notes = await listNotes(supabase);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-display text-xl font-light text-ink">Research notes</h1>
        <Link href="/admin/notes/new">
          <Button variant="primary">New note</Button>
        </Link>
      </div>

      {notes.length === 0 ? (
        <p className="card p-8 text-center text-sm text-muted">No notes yet.</p>
      ) : (
        <ul className="card divide-y divide-edge">
          {notes.map((n) => (
            <li key={n.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <Link
                href={`/admin/notes/${n.id}`}
                className="min-w-0 flex-1 text-sm text-ink hover:text-accent"
              >
                {n.title}
              </Link>
              <span className="font-mono text-xs text-muted">{formatDate(n.updated_at)}</span>
              <Badge>{n.published ? "published" : "draft"}</Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
