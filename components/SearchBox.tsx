"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

export function SearchBox({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initialQuery);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const q = value.trim();
    router.push(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
  }

  return (
    <form onSubmit={onSubmit} className="flex items-center gap-2">
      <div className="flex flex-1 items-center gap-2 rounded border border-edge bg-void px-3">
        <Search size={16} className="text-muted" aria-hidden />
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Search the knowledge map…"
          aria-label="Search"
          className="w-full bg-transparent py-2.5 text-sm text-ink outline-none placeholder:text-muted"
        />
      </div>
      <button
        type="submit"
        className="rounded bg-accent px-4 py-2.5 text-sm font-medium text-void hover:opacity-90"
      >
        Search
      </button>
    </form>
  );
}
