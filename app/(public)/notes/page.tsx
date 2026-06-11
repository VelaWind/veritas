import type { Metadata } from "next";
import Link from "next/link";
import { publicClient } from "@/lib/supabase/public";
import { listNotes } from "@/lib/queries/notes";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatDate } from "@/lib/utils";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Research notes",
  description: "Essays and methodological notes from the Veritas project.",
};

export default async function NotesPage() {
  // RLS hides unpublished notes from the anon client.
  const notes = (await listNotes(publicClient)).filter((n) => n.published);

  return (
    <div className="mx-auto max-w-content space-y-8 px-4 py-12 sm:px-6">
      <PageHeader
        eyebrow="Field notes"
        title="Research notes"
        description="How Veritas thinks about uncertainty, evidence, and the discipline of honest confidence."
      />

      {notes.length === 0 ? (
        <EmptyState
          title="No published notes yet"
          description="Published research notes will appear here."
        />
      ) : (
        <ul className="card divide-y divide-edge">
          {notes.map((n) => (
            <li key={n.id}>
              <Link
                href={`/notes/${n.slug}`}
                className="flex items-center gap-4 px-6 py-5 transition-colors hover:bg-raised"
              >
                <span className="font-display text-lg font-light text-ink">{n.title}</span>
                <span className="ml-auto shrink-0 font-mono text-xs text-muted">
                  {formatDate(n.created_at)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
