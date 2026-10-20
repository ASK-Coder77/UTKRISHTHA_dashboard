"use client";
// Why "use client": uses window.matchMedia, window/document event listeners,
// useRef for imperative DOM access, and gsap.quickTo / gsap.context —
// all browser-only APIs that must run after mount.

import { useEffect, useRef } from "react";
import { gsap } from "gsap";

export function InteractiveBackground() {
  const blob1Ref = useRef<HTMLDivElement>(null);
  const blob2Ref = useRef<HTMLDivElement>(null);
  const blob3Ref = useRef<HTMLDivElement>(null);
  const largeGlowRef = useRef<HTMLDivElement>(null);
  const coreGlowRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // prefers-reduced-motion: render nothing animated, static gradient only
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const noHover = window.matchMedia("(hover: none)").matches;
    let pointerHandler: ((e: PointerEvent) => void) | null = null;
    let glowVisible = false;

    const ctx = gsap.context(() => {
      // ── Layer A: drifting blobs ──────────────────────────────────────────
      // Fade blobs in staggered, then loop forever with sine/yoyo drift.
      // Only transform is animated — no layout-triggering properties.
      const blobs = [blob1Ref.current, blob2Ref.current, blob3Ref.current].filter(
        Boolean,
      ) as HTMLDivElement[];

      gsap.to(blobs, { opacity: 1, duration: 2.5, stagger: 0.6, ease: "power2.inOut" });
      gsap.to(blob1Ref.current, {
        x: 110, y: -90,
        duration: 30, ease: "sine.inOut", yoyo: true, repeat: -1,
      });
      gsap.to(blob2Ref.current, {
        x: -100, y: 85,
        duration: 38, ease: "sine.inOut", yoyo: true, repeat: -1, delay: 5,
      });
      gsap.to(blob3Ref.current, {
        x: 55, y: 65,
        duration: 24, ease: "sine.inOut", yoyo: true, repeat: -1, delay: 10,
      });

      // ── Layer B: cursor glow (pointer/hover devices only) ────────────────
      // Large glow (600px) follows with 0.6s lag; small core (200px) with 0.25s.
      // Positioned at top:0 left:0 with negative margin so GSAP x/y = cursor pos.
      if (!noHover) {
        const large = largeGlowRef.current;
        const core = coreGlowRef.current;
        if (large && core) {
          const midX = window.innerWidth / 2;
          const midY = window.innerHeight / 2;
          gsap.set(large, { x: midX, y: midY });
          gsap.set(core, { x: midX, y: midY });

          const xL = gsap.quickTo(large, "x", { duration: 0.6, ease: "power3.out" });
          const yL = gsap.quickTo(large, "y", { duration: 0.6, ease: "power3.out" });
          const xC = gsap.quickTo(core, "x", { duration: 0.25, ease: "power3.out" });
          const yC = gsap.quickTo(core, "y", { duration: 0.25, ease: "power3.out" });

          pointerHandler = (e: PointerEvent) => {
            xL(e.clientX);
            yL(e.clientY);
            xC(e.clientX);
            yC(e.clientY);

            // Layer C: update CSS vars for grid mask brightening
            if (gridRef.current) {
              gridRef.current.style.setProperty("--mx", `${e.clientX}px`);
              gridRef.current.style.setProperty("--my", `${e.clientY}px`);
            }

            // Fade glows in on first pointer move
            if (!glowVisible) {
              glowVisible = true;
              gsap.to(
                [large, core, gridRef.current].filter(Boolean),
                { opacity: 1, duration: 0.8, ease: "power2.out" },
              );
            }
          };

          window.addEventListener("pointermove", pointerHandler, { passive: true });
        }
      }
    });

    // Pause all GSAP when tab is hidden to save CPU; resume when visible
    const onVisibility = () => {
      if (document.hidden) gsap.globalTimeline.pause();
      else gsap.globalTimeline.resume();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      ctx.revert();
      document.removeEventListener("visibilitychange", onVisibility);
      // pointer listener is set inside ctx but must be removed outside it
      if (pointerHandler) window.removeEventListener("pointermove", pointerHandler);
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      {/* Static radial gradient — always visible, even with reduced-motion */}
      <div className="background-static absolute inset-0" />

      {/* ── Layer A: slow-drifting blobs ─────────────────────────────────── */}
      <div
        ref={blob1Ref}
        className="background-blob-primary absolute -top-[18%] -right-[8%] size-[620px] rounded-full blur-[64px] opacity-0 will-change-transform"
      />
      <div
        ref={blob2Ref}
        className="background-blob-accent absolute -bottom-[12%] -left-[6%] size-[500px] rounded-full blur-[80px] opacity-0 will-change-transform"
      />
      <div
        ref={blob3Ref}
        className="background-blob-sky absolute top-[35%] left-1/2 size-[380px] rounded-full blur-[72px] opacity-0 will-change-transform"
      />

      {/* ── Layer B: cursor glow (desktop / hover devices only) ──────────── */}
      {/* top:0, left:0 + negative margin so GSAP x/y values equal clientX/Y */}
      <div
        ref={largeGlowRef}
        className="background-cursor-large absolute -mt-[300px] -ml-[300px] size-[600px] rounded-full opacity-0 will-change-transform"
      />
      <div
        ref={coreGlowRef}
        className="background-cursor-core absolute -mt-[100px] -ml-[100px] size-[200px] rounded-full opacity-0 will-change-transform"
      />

      {/* ── Layer C: grid brightened near cursor via CSS mask ────────────── */}
      {/* --mx / --my are updated from pointermove; opacity keeps this hidden until then. */}
      <div
        ref={gridRef}
        className="background-grid-focus absolute inset-0 opacity-0"
      />
    </div>
  );
}
