"use client";

import { Markdown } from "@/components/Markdown";
import { Tabs } from "@/components/ui/Tabs";
import { inputClass } from "@/components/ui/Field";
import { cn } from "@/lib/utils";

export function MarkdownEditor({
  id,
  value,
  onChange,
  rows = 8,
  placeholder,
}: {
  id?: string;
  value: string;
  onChange: (next: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <Tabs
      tabs={[
        {
          key: "write",
          label: "Write",
          content: (
            <textarea
              id={id}
              value={value}
              rows={rows}
              placeholder={placeholder}
              onChange={(e) => onChange(e.target.value)}
              className={cn(inputClass, "font-mono leading-relaxed")}
            />
          ),
        },
        {
          key: "preview",
          label: "Preview",
          content: value.trim() ? (
            <div className="rounded border border-edge bg-void p-4">
              <Markdown>{value}</Markdown>
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-muted">Nothing to preview.</p>
          ),
        },
      ]}
    />
  );
}
