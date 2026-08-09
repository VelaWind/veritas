"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./ThemeToggle";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/domains", label: "Domains" },
  { href: "/hypotheses", label: "Hypotheses" },
  { href: "/evidence", label: "Evidence" },
  { href: "/questions", label: "Questions" },
  { href: "/timeline", label: "Timeline" },
  { href: "/graph", label: "Graph" },
  { href: "/lab", label: "Lab" },
  { href: "/notes", label: "Notes" },
  { href: "/agents", label: "Agents" },
] as const;

function Reticle() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden
      className="text-accent"
    >
      <circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="1.25" />
      <circle cx="9" cy="9" r="1.5" fill="currentColor" />
      <path d="M9 0v4M9 14v4M0 9h4M14 9h4" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  );
}

export function SiteNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="sticky top-0 z-40 border-b border-edge bg-void/90 backdrop-blur">
      <nav
        aria-label="Primary"
        className="mx-auto flex h-14 max-w-content items-center gap-4 px-4 sm:px-6"
      >
        <Link
          href="/"
          className="flex items-center gap-2.5 font-display text-lg font-medium tracking-wide text-ink"
          onClick={() => setOpen(false)}
        >
          <Reticle />
          VERITAS
        </Link>

        <div className="hidden flex-1 items-center justify-center gap-0.5 lg:flex">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={isActive(l.href) ? "page" : undefined}
              className={cn(
                "rounded px-2.5 py-1.5 text-sm transition-colors",
                isActive(l.href)
                  ? "bg-raised text-ink"
                  : "text-muted hover:bg-raised hover:text-ink",
              )}
            >
              {l.label}
            </Link>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1 lg:ml-0">
          <button
            type="button"
            data-command-palette-trigger
            onClick={() => {
              // CommandPalette listens for this event; /search is the fallback.
              window.dispatchEvent(new CustomEvent("veritas:open-palette"));
            }}
            aria-label="Search (Ctrl+K)"
            className="flex items-center gap-2 rounded border border-edge px-2.5 py-1.5 text-sm text-muted transition-colors hover:bg-raised hover:text-ink"
          >
            <Search size={14} aria-hidden />
            <span className="hidden sm:inline">Search</span>
            <kbd className="hidden rounded bg-raised px-1.5 py-0.5 font-mono text-xs sm:inline">
              ⌘K
            </kbd>
          </button>
          <ThemeToggle />
          <button
            type="button"
            className="rounded p-2 text-muted hover:bg-raised hover:text-ink lg:hidden"
            aria-expanded={open}
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X size={18} aria-hidden /> : <Menu size={18} aria-hidden />}
          </button>
        </div>
      </nav>

      {open && (
        <div className="border-t border-edge bg-surface lg:hidden">
          <div className="mx-auto grid max-w-content gap-0.5 px-4 py-3 sm:px-6">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                aria-current={isActive(l.href) ? "page" : undefined}
                onClick={() => setOpen(false)}
                className={cn(
                  "rounded px-3 py-2 text-sm",
                  isActive(l.href)
                    ? "bg-raised text-ink"
                    : "text-muted hover:bg-raised hover:text-ink",
                )}
              >
                {l.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}
