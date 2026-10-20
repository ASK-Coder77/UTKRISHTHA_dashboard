/**
 * Card — rounded-2xl container with border, white surface, and optional
 * lift+glow on hover.
 *
 * Server Component: no "use client" — purely structural JSX.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface CardProps {
  children: ReactNode;
  className?: string;
  /** Adds a subtle lift + blue glow on pointer hover. */
  hover?: boolean;
  /** Renders as a <section> instead of <div> for landmark semantics. */
  as?: "div" | "section" | "article";
}

export function Card({ children, className, hover = false, as: Tag = "div" }: CardProps) {
  return (
    <Tag
      className={cn(
        "rounded-2xl border border-border bg-surface p-5 shadow-card",
        hover && "transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-glow",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

/**
 * Small square icon tile shown at the top-left of feature cards.
 * Uses a light primary tint as background.
 */
export function CardIconTile({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "mb-4 flex size-11 shrink-0 items-center justify-center self-start rounded-xl bg-icon-tile text-primary",
        className,
      )}
    >
      {children}
    </div>
  );
}
