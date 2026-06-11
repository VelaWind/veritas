"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { api } from "@/lib/client-api";
import { sanitizeHeadline } from "@/lib/utils";
import { useFocusTrap } from "@/lib/useFocusTrap";
import type { NodeType, SearchResult } from "@/types/domain";

const PATH: Partial<Record<NodeType, string>> = {
  hypothesis: "/hypotheses",
  question: "/questions",
  evidence: "/evidence",
};

const TYPE_LABEL: Record<NodeType, string> = {
  hypothesis: "Hypothesis",
  question: "Question",
  evidence: "Evidence",
  domain: "Domain",
  simulation: "Simulation",
};

/**
 * §3 ⌘K command palette over global_search(). Opens on ⌘K / Ctrl+K and on the
 * 'veritas:open-palette' event dispatched by the nav search button.
 */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqId = useRef(0);

  useFocusTrap(dialogRef, open);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setResults([]);
    setActive(0);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") setOpen(false);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("veritas:open-palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("veritas:open-palette", onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (query.trim().length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounce.current = setTimeout(async () => {
      const id = ++reqId.current;
      const res = await api.get<SearchResult[]>(
        `/api/search?q=${encodeURIComponent(query.trim())}&limit=12`,
      );
      if (id !== reqId.current) return;
      setResults(res.data ?? []);
      setActive(0);
      setLoading(false);
    }, 180);
  }, [query]);

  function go(result: SearchResult) {
    const base = PATH[result.node_type];
    if (!base) return;
    close();
    router.push(`${base}/${result.slug}`);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[active]) go(results[active]);
      else if (query.trim()) {
        close();
        router.push(`/search?q=${encodeURIComponent(query.trim())}`);
      }
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Search Veritas"
        className="card w-full max-w-xl overflow-hidden p-0"
      >
        <div className="flex items-center gap-3 border-b border-edge px-4">
          <Search size={16} className="text-muted" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search hypotheses, questions, evidence…"
            aria-label="Search query"
            className="w-full bg-transparent py-4 text-sm text-ink outline-none placeholder:text-muted"
          />
          <kbd className="rounded bg-raised px-1.5 py-0.5 font-mono text-xs text-muted">
            esc
          </kbd>
        </div>

        <div className="max-h-[50vh] overflow-y-auto">
          {loading && query.trim().length >= 2 && results.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-muted">Searching…</p>
          )}
          {!loading && query.trim().length >= 2 && results.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-muted">
              No matches for “{query.trim()}”.
            </p>
          )}
          {query.trim().length < 2 && (
            <p className="px-4 py-6 text-center text-sm text-muted">
              Type at least two characters. Full-text search across the map.
            </p>
          )}
          <ul>
            {results.map((r, i) => (
              <li key={`${r.node_type}-${r.id}`}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(r)}
                  className={`flex w-full items-start gap-3 px-4 py-3 text-left ${
                    i === active ? "bg-raised" : ""
                  }`}
                >
                  <span className="mt-0.5 shrink-0 font-mono text-xs uppercase text-muted">
                    {TYPE_LABEL[r.node_type]}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-ink">{r.title}</span>
                    {r.snippet && (
                      <span
                        className="snippet mt-0.5 block text-xs text-muted"
                        dangerouslySetInnerHTML={{ __html: sanitizeHeadline(r.snippet) }}
                      />
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {results.length > 0 && (
          <div className="flex items-center justify-between border-t border-edge px-4 py-2 font-mono text-xs text-muted">
            <span>↑↓ navigate · ↵ open</span>
            <button
              type="button"
              onClick={() => {
                close();
                router.push(`/search?q=${encodeURIComponent(query.trim())}`);
              }}
              className="hover:text-ink"
            >
              See all results →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
