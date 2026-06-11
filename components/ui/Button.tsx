import { ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-void hover:opacity-90 disabled:opacity-50",
  secondary:
    "border border-edge bg-surface text-ink hover:bg-raised disabled:opacity-50",
  ghost: "text-muted hover:bg-raised hover:text-ink disabled:opacity-50",
  // Contradiction red is reserved; destructive UI uses a neutral treatment
  // with explicit labeling instead of a signal hue.
  danger:
    "border border-edge bg-surface text-ink hover:bg-raised disabled:opacity-50 underline-offset-4 hover:underline",
};

const sizes: Record<Size, string> = {
  sm: "px-2.5 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "secondary", size = "md", type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded font-medium transition-colors",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = "Button";
