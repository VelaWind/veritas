import { ReactNode, useId } from "react";
import { cn } from "@/lib/utils";

export const inputClass =
  "w-full rounded border border-edge bg-void px-3 py-2 text-sm text-ink placeholder:text-muted disabled:opacity-50";

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: (id: string) => ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="eyebrow block">
        {label}
      </label>
      {children(id)}
      {hint && !error && <p className="text-xs text-muted">{hint}</p>}
      {error && (
        <p role="alert" className="text-xs" style={{ color: "var(--contradiction)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
