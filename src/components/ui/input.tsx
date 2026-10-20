/**
 * Input — styled <input> wrapper.
 *
 * Server Component: no "use client" needed.
 * Why: this component has no hooks or browser APIs. Value/onChange are
 * forwarded props; they are always supplied by parent Client Components
 * (like AuctionWorkspace), which is valid in the Next.js App Router model.
 */
import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "block w-full rounded-xl border border-border px-3 py-2",
        "text-deep placeholder:text-muted",
        "focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "transition-colors",
        className,
      )}
      {...props}
    />
  );
}
