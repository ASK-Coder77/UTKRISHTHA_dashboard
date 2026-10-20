import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import "./globals.css";
import { TopNavServer } from "@/components/nav/top-nav-server";
import { InteractiveBackground } from "@/components/effects/interactive-background";

/*
 * Poppins loaded via next/font/google — self-hosted by Next.js so no
 * external font CDN is needed in the CSP. The CSS variable --font-poppins
 * is injected on <html> and consumed by globals.css:
 *   --font-sans: var(--font-poppins), ui-sans-serif, system-ui, sans-serif;
 */
const poppins = Poppins({
  subsets:  ["latin"],
  weight:   ["400", "500", "600", "700"],
  variable: "--font-poppins",
  display:  "swap",
});

export const metadata: Metadata = {
  title:       "Utkrishta Dashboard",
  description: "Event dashboard for Utkrishta by Epoch AIML Club.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={poppins.variable}>
      <body>
        {/*
         * InteractiveBackground: fixed, -z-10, pointer-events-none —
         * sits behind every page. "use client" because it uses GSAP,
         * window event listeners, and matchMedia (all browser-only).
         */}
        <InteractiveBackground />
        {/*
         * TopNavServer is a Server Component that reads auth + role and
         * renders the sticky top navigation bar on every page.
         */}
        <TopNavServer />
        {children}
      </body>
    </html>
  );
}
