"use client";
// Why "use client" for Reveal: uses useRef for the GSAP DOM target, useLayoutEffect to
//   register ScrollTrigger and run GSAP animations (browser-only APIs), and
//   window.matchMedia. None of these work in a Server Component.
// Why "use client" for MagneticButton: attaches pointermove/pointerleave listeners to
//   the DOM node and runs gsap.to on pointer position. This is imperative,
//   browser-only code that must run after mount.

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { cn } from "@/lib/cn";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

// ── Reveal ────────────────────────────────────────────────────────────────────
// Fades and rises its children into view, exactly ONCE per page load.
// - Elements already on screen animate immediately (no waiting for scroll).
// - Off-screen elements animate the first time they enter the viewport, then their
//   trigger is destroyed, so scrolling back never hides or replays anything.
// - After playing, inline opacity/transform are cleared so the element returns to its
//   natural CSS state.
// - Reduced motion: no animation at all, content is simply visible.

interface RevealProps {
  children: ReactNode;
  /** Animate direct children with this stagger delay (seconds). Use ~0.06. */
  stagger?: number;
  /** Slide direction on desktop. Mobile always rises from below. */
  from?: "left" | "right" | "below";
  /** Animate on mount instead of on scroll (for above-the-fold content). */
  load?: boolean;
  className?: string;
}

export function Reveal({
  children,
  stagger,
  from = "below",
  load = false,
  className,
}: RevealProps) {
  const wrapRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const isMobile = window.matchMedia("(max-width: 767px)").matches;
    const targets = stagger ? Array.from(el.children) : [el];
    const offsetX = isMobile ? 0 : from === "left" ? -48 : from === "right" ? 48 : 0;

    const isInViewport = () => {
      const b = el.getBoundingClientRect();
      return b.top < window.innerHeight && b.bottom > 0;
    };

    let safetyTimer: number | undefined;
    let mounted = true;

    const ctx = gsap.context(() => {
      // One paused tween that plays exactly once, then clears its inline styles.
            const tween = gsap.fromTo(
        targets,
        { opacity: 0, y: 28, x: offsetX },
        {
          opacity: 1,
          y: 0,
          x: 0,
          duration: 0.8,
          ease: "power3.out",
          stagger: stagger ?? 0,
          delay: load ? 0.1 : 0,
          paused: true,
          onComplete: () => {
            gsap.set(targets, { clearProps: "opacity,transform" });
          },
        },
      );

      if (load) {
        tween.play();
      } else {
        ScrollTrigger.create({
          trigger: el,
          start: "top 70%", // the section must be well inside the screen first
          once: true,
          onEnter: () => tween.play(),
        });
      }

      // Safety net: if the trigger somehow never fired for content that is clearly
      // in view, show it. Uses the same threshold as the trigger, so it can't
      // play early.
      safetyTimer = window.setTimeout(() => {
        const top = el.getBoundingClientRect().top;
        if (mounted && top < window.innerHeight * 0.7 && tween.paused() && tween.progress() === 0) {
          tween.play();
        }
      }, 2500);
    }, el);

    // Recalculate trigger positions once fonts have loaded (no replay: triggers are
    // "once" and already-played tweens are not restarted by a refresh).
    if (document.fonts) {
      void document.fonts.ready.then(() => {
        if (mounted) ScrollTrigger.refresh();
      });
    }

    return () => {
      mounted = false;
      if (safetyTimer !== undefined) window.clearTimeout(safetyTimer);
      ctx.revert(); // also kills the ScrollTrigger and restores the natural state
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={wrapRef} className={className}>
      {children}
    </div>
  );
}

// ── MagneticButton ────────────────────────────────────────────────────────────
// Wraps a button-like child and makes it drift a few px toward the cursor,
// snapping back with an elastic ease on leave. Desktop / hover devices only.
// It only moves transform; it never changes opacity or visibility.

interface MagneticButtonProps {
  children: ReactNode;
  className?: string;
  /** Max pixel shift toward cursor. Default 8. */
  strength?: number;
}

export function MagneticButton({
  children,
  className,
  strength = 8,
}: MagneticButtonProps) {
  const wrapRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    if (window.matchMedia("(hover: none)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const ctx = gsap.context(() => {
      const onMove = (e: PointerEvent) => {
        const rect = el.getBoundingClientRect();
        const dx = e.clientX - (rect.left + rect.width / 2);
        const dy = e.clientY - (rect.top + rect.height / 2);
        gsap.to(el, {
          x: dx * (strength / (rect.width / 2)),
          y: dy * (strength / (rect.height / 2)),
          duration: 0.3,
          ease: "power2.out",
          overwrite: "auto",
        });
      };

      const onLeave = () => {
        gsap.to(el, {
          x: 0,
          y: 0,
          duration: 0.45,
          ease: "elastic.out(1, 0.4)",
          overwrite: "auto",
        });
      };

      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerleave", onLeave);

      return () => {
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerleave", onLeave);
      };
    }, el);

    return () => {
      gsap.killTweensOf(el);
      ctx.revert();
      gsap.set(el, { clearProps: "transform" });
    };
  }, [strength]);

  return (
    <div ref={wrapRef} className={cn("inline-flex", className)}>
      {children}
    </div>
  );
}