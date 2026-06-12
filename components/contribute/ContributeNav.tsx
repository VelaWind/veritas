"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/contribute", label: "Overview", exact: true },
  { href: "/contribute/hypotheses/new", label: "Propose hypothesis" },
  { href: "/contribute/evidence/new", label: "Propose evidence" },
  { href: "/contribute/suggestions", label: "My suggestions" },
];

export function ContributeNav({
  displayName,
  role,
}: {
  displayName: string;
  role: string;
}) {
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
        Contribute · <span className="text-ink">{displayName}</span>
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
      {role === "admin" && (
        <Link
          href="/admin/suggestions"
          className="rounded px-3 py-1.5 text-sm text-muted hover:bg-raised hover:text-ink"
        >
          Review queue →
        </Link>
      )}
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
