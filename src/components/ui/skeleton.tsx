/**
 * Skeleton shimmer — light blue pulse placeholder for loading states.
 *
 * Server Component: no "use client" needed — purely presentational.
 * The animate-pulse animation is disabled automatically by the global
 * prefers-reduced-motion rule in globals.css.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-xl bg-tint", className)}
    />
  );
}

/**
 * Pre-composed skeleton that mimics a Card with a heading + body lines.
 * Use in loading states where a Card will appear.
 */
export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-card space-y-3">
      <Skeleton className="h-5 w-2/3" />
      <Skeleton className="h-3 w-1/3" />
      {Array.from({ length: lines - 1 }).map((_, i) => (
        <Skeleton key={i} className="h-4 w-full" />
      ))}
    </div>
  );
}

/** A full-width loading bar (e.g. below the navbar). */
export function SkeletonBar({ className }: { className?: string }) {
  return <Skeleton className={cn("h-4 w-full", className)} />;
}

/** A compact row of skeleton cells — useful for table placeholders. */
export function SkeletonRow({ children }: { children?: ReactNode }) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-border bg-surface px-5 py-4">
      {children ?? (
        <>
          <Skeleton className="size-8 rounded-full shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </>
      )}
    </div>
  );
}
