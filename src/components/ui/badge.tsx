/**
 * Badge — pill-shaped label for status, track, role, etc.
 *
 * Server Component: no "use client" — purely presentational.
 * All text colors are WCAG AA on white (tested against the design tokens).
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type BadgeVariant =
  | "primary"   // blue  — active states, tracks
  | "success"   // green — live, published
  | "warn"      // amber — upcoming, warnings
  | "error"     // red   — closed, error
  | "neutral";  // slate — informational

const variantClasses: Record<BadgeVariant, string> = {
  primary: "bg-primary/10 text-primary  border-primary/20",
  success: "bg-green-50  text-success   border-green-200",
  warn:    "bg-amber-50  text-warn      border-amber-200",
  error:   "bg-red-50    text-error     border-red-200",
  neutral: "bg-slate-100 text-slate-700 border-slate-200",
};

export function Badge({
  variant = "neutral",
  className,
  children,
}: {
  variant?: BadgeVariant;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        variantClasses[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
