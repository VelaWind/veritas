import { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 border-b border-edge pb-8 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-3">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="max-w-2xl font-display text-2xl font-light text-ink">{title}</h1>
        {description && <div className="max-w-2xl text-muted">{description}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-3">{actions}</div>}
    </header>
  );
}
