/**
 * Select — styled <select> wrapper matching the Input visual.
 *
 * Server Component: no "use client" needed (same reasoning as Input).
 */
import type { SelectHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Select({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "block w-full rounded-xl border border-border bg-surface px-3 py-2",
        "text-deep",
        "focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "transition-colors",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}
