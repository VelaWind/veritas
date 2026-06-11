import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { publicClient } from "@/lib/supabase/public";
import { getNoteBySlug, listNoteSlugs } from "@/lib/queries/notes";
import { Markdown } from "@/components/Markdown";
import { formatDate, stripMarkdown, truncate } from "@/lib/utils";

export const revalidate = 3600;

export async function generateStaticParams() {
  const slugs = await listNoteSlugs(publicClient);
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const note = await getNoteBySlug(publicClient, slug);
  if (!note || !note.published) return { title: "Note not found" };
  return {
    title: note.title,
    description: truncate(stripMarkdown(note.body), 160),
  };
}

export default async function NoteDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const note = await getNoteBySlug(publicClient, slug);
  // RLS returns nothing for unpublished notes to anon readers.
  if (!note || !note.published) notFound();

  return (
    <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <header className="space-y-3 border-b border-edge pb-8">
        <p className="eyebrow">Research note · {formatDate(note.created_at)}</p>
        <h1 className="font-display text-2xl font-light text-ink">{note.title}</h1>
      </header>
      <div className="py-10">
        <Markdown>{note.body}</Markdown>
      </div>
      <Link href="/notes" className="link text-sm">
        ← All research notes
      </Link>
    </article>
  );
}
