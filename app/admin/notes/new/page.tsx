import { NoteForm } from "@/components/admin/NoteForm";

export const metadata = { title: "Admin · New note" };

export default function NewNotePage() {
  return (
    <div className="space-y-6">
      <h1 className="font-display text-xl font-light text-ink">New research note</h1>
      <NoteForm />
    </div>
  );
}
