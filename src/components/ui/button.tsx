/**
 * Button — styled <button> wrapper with variant, size, and loading state.
 *
 * Server Component: no "use client" needed.
 * Why: Button contains no hooks or browser-only APIs. The `loading` and
 * `disabled` props are plain boolean values evaluated at render time.
 * Event handlers (onClick, etc.) are always passed from parent Client
 * Components, which is valid — the component just forwards props to the
 * underlying <button>.
 *
 * The primary variant carries a soft shadow-glow-sm to match the reference
 * design. White text on the primary token passes WCAG AA.
 */
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type ButtonVariant = "primary" | "outline" | "ghost" | "danger";
type ButtonSize    = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?:    ButtonSize;
  /** When true the button shows a spinner and is automatically disabled. */
  loading?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-white hover:bg-primary-hover shadow-glow-sm " +
    "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
  outline:
    "border border-border bg-surface text-primary hover:bg-tint " +
    "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
  ghost:
    "text-primary hover:bg-tint " +
    "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
  danger:
    "border border-error/30 text-error hover:bg-error/10 " +
    "focus-visible:ring-2 focus-visible:ring-error/40 focus-visible:ring-offset-2",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-xs  rounded-lg",
  md: "px-4 py-2   text-sm  rounded-xl",
  lg: "px-6 py-3   text-base rounded-2xl",
};

export function Button({
  variant  = "primary",
  size     = "md",
  loading  = false,
  disabled,
  className,
  children,
  ...props
}: ButtonProps) {
  const isDisabled = disabled ?? loading;
  return (
    <button
      disabled={isDisabled}
      className={cn(
        "inline-flex items-center justify-center gap-2 font-semibold transition-all focus-visible:outline-none",
        variantClasses[variant],
        sizeClasses[size],
        isDisabled && "cursor-not-allowed opacity-60 shadow-none",
        className,
      )}
      {...props}
    >
      {loading && (
        /* Spinning ring — pure CSS, no library */
        <span
          aria-hidden="true"
          className="size-4 rounded-full border-2 border-current border-t-transparent animate-spin"
        />
      )}
      {children}
    </button>
  );
}
