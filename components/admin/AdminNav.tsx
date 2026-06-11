"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/admin", label: "Overview", exact: true },
  { href: "/admin/domains", label: "Domains" },
  { href: "/admin/questions", label: "Questions" },
  { href: "/admin/hypotheses", label: "Hypotheses" },
  { href: "/admin/evidence", label: "Evidence" },
  { href: "/admin/simulations", label: "Simulations" },
  { href: "/admin/notes", label: "Notes" },
  { href: "/admin/contradictions", label: "Contradictions" },
];

export function AdminNav({ displayName }: { displayName: string }) {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <aside className="flex shrink-0 flex-row flex-wrap items-center gap-1 border-b border-edge pb-4 lg:w-48 lg:flex-col lg:items-stretch lg:border-b-0 lg:border-r lg:pb-0 lg:pr-6">
      <p className="eyebrow w-full pb-2 lg:pb-4">
        Admin · <span className="text-ink">{displayName}</span>
      </p>
      {LINKS.map((l) => {
        const active = l.exact ? pathname === l.href : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded px-3 py-1.5 text-sm",
              active ? "bg-raised text-ink" : "text-muted hover:bg-raised hover:text-ink",
            )}
          >
            {l.label}
          </Link>
        );
      })}
      <button
        type="button"
        onClick={signOut}
        className="rounded px-3 py-1.5 text-left text-sm text-muted hover:bg-raised hover:text-ink"
      >
        Sign out
      </button>
    </aside>
  );
}
