/**
 * Alert — semantic alert/status box replacing the inline `rounded-md bg-red-50
 * p-3 text-red-800` pattern used throughout the existing workspaces.
 *
 * Server Component: no "use client" needed — purely presentational.
 *
 * All text colors pass WCAG AA on white:
 * Semantic colors use the global design tokens.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { CheckCircleIcon, AlertCircleIcon, InfoIcon } from "@/components/ui/icons";

type AlertVariant = "info" | "success" | "warn" | "error";

const styles: Record<AlertVariant, { wrapper: string; Icon: typeof InfoIcon }> = {
  info:    { wrapper: "bg-tint border-border text-primary", Icon: InfoIcon },
  success: { wrapper: "bg-success/10 border-success/30 text-success", Icon: CheckCircleIcon },
  warn:    { wrapper: "bg-warn/10 border-warn/30 text-warn", Icon: AlertCircleIcon },
  error:   { wrapper: "bg-error/10 border-error/30 text-error", Icon: AlertCircleIcon },
};

export function Alert({
  variant = "info",
  role: ariaRole,
  className,
  children,
}: {
  variant?:  AlertVariant;
  /** Defaults to "alert" for error, "status" for others. */
  role?:     "alert" | "status";
  className?: string;
  children:  ReactNode;
}) {
  const { wrapper, Icon } = styles[variant];
  return (
    <div
      role={ariaRole ?? (variant === "error" ? "alert" : "status")}
      aria-live={variant === "error" ? "assertive" : "polite"}
      className={cn(
        "flex items-start gap-3 rounded-xl border p-4 text-sm font-medium",
        wrapper,
        className,
      )}
    >
      <Icon className="mt-0.5 shrink-0 size-4" />
      <span>{children}</span>
    </div>
  );
}
