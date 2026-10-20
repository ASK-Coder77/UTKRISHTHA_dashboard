/**
 * TopNav — client component for the sticky top navigation bar.
 *
 * Why "use client":
 *   • usePathname() — determines the active route and closes the mobile
 *     sheet after navigation; this is a browser-only hook.
 *   • useState — controls the mobile hamburger drawer open/close state.
 *   • useEffect — closes the mobile sheet on route change.
 *
 * The component receives all data as plain props from the Server Component
 * wrapper (top-nav-server.tsx) so no client-side data fetching is needed.
 */
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { AppRole } from "@/lib/roles";
import { cn } from "@/lib/cn";
import { signInWithGoogle } from "@/app/actions";
import {
  MenuIcon,
  XIcon,
  ChevronDownIcon,
  LogOutIcon,
} from "@/components/ui/icons";

/* ─── Types ──────────────────────────────────────────────────────────── */

interface NavLink {
  href:  string;
  label: string;
}

export interface TopNavProps {
  role:             AppRole | null;
  userName:         string | null;
  resultsPublished: boolean;
  hasTeam:          boolean;
}

/* ─── Role → links (cosmetic only — server routes always re-check role) ─ */

function getNavLinks(
  role:             AppRole | null,
  hasTeam:          boolean,
  resultsPublished: boolean,
): NavLink[] {
  const links: NavLink[] = [
    { href: "/", label: "Home" },
    { href: "/events", label: "Events" },
    { href: "/rules", label: "Rules" },
  ];

  if (role === "student" || role === "team_leader") {
    if (!hasTeam) {
      links.push({ href: "/register-team", label: "Register Team" });
    }
    links.push({ href: "/team", label: "My Team" });
    links.push({ href: "/auction", label: "Auction" });
    if (resultsPublished) {
      links.push({ href: "/results", label: "Results" });
    }
  }

  if (role === "judge") {
    links.push({ href: "/judge", label: "Judging" });
  }

  if (role === "admin" || role === "super_admin") {
    links.push({ href: "/admin", label: "Admin" });
    links.push({ href: "/results", label: "Results" });
    if (role === "super_admin") {
      links.push({ href: "/admin/settings", label: "Settings" });
      links.push({ href: "/admin/users", label: "Users" });
    }
  }

  return links;
}

function getRoleLabel(role: AppRole | null): string {
  switch (role) {
    case "super_admin": return "Super Admin";
    case "admin":       return "Admin";
    case "judge":       return "Judge";
    case "team_leader": return "Team Leader";
    case "student":     return "Student";
    default:            return "Guest";
  }
}

/* ─── Active-link helpers ─────────────────────────────────────────────── */

function isActive(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

/* ─── NavItem (desktop) ───────────────────────────────────────────────── */

function NavItem({ link, pathname }: { link: NavLink; pathname: string }) {
  const active = isActive(link.href, pathname);
  return (
    <Link
      href={link.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "text-sm font-medium text-deep transition-colors md:text-base",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
        active
          ? "font-semibold text-primary"
          : "hover:text-primary",
      )}
    >
      {link.label}
    </Link>
  );
}

/* ─── MobileNavItem ───────────────────────────────────────────────────── */

function MobileNavItem({
  link,
  pathname,
  onNavigate,
}: {
  link:       NavLink;
  pathname:   string;
  onNavigate: () => void;
}) {
  const active = isActive(link.href, pathname);
  return (
    <Link
      href={link.href}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      className={cn(
        "flex min-h-11 items-center px-4 text-base font-medium text-deep transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        active
          ? "font-semibold text-primary"
          : "hover:text-primary",
      )}
    >
      {link.label}
    </Link>
  );
}

/* ─── UserMenu (Radix DropdownMenu) ───────────────────────────────────── */

function UserMenu({ role, userName }: Pick<TopNavProps, "role" | "userName">) {
  const initial = userName?.charAt(0).toUpperCase() ?? "U";
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function handleSignOut() {
    if (isSigningOut) return;

    setIsSigningOut(true);
    await signOut({ redirectTo: "/" });
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className={cn(
          "flex items-center gap-2 px-1 py-1.5 text-sm font-medium text-deep",
          "hover:text-primary transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
        )}
        aria-label="User menu"
      >
        {/* Avatar initial tile */}
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
          {initial}
        </span>
        {userName && (
          <span className="hidden max-w-[8rem] truncate sm:block">
            {userName}
          </span>
        )}
        <ChevronDownIcon className="size-3.5 shrink-0" />
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className={cn(
            "z-50 min-w-[180px] rounded-2xl border border-border bg-surface p-2",
            "shadow-glow animate-in fade-in-0 zoom-in-95",
          )}
        >
          {/* Role badge */}
          <div className="px-3 py-2">
            <p className="text-xs font-medium uppercase tracking-wider text-muted">
              Signed in as
            </p>
            <p className="mt-0.5 text-sm font-semibold text-deep">
              {getRoleLabel(role)}
            </p>
          </div>

          <DropdownMenu.Separator className="my-1 h-px bg-border" />

          {/* Use Auth.js's browser helper: Radix menu items do not reliably
              submit nested forms after they handle selection. */}
          <DropdownMenu.Item asChild>
            <button
              type="button"
              disabled={isSigningOut}
              onClick={() => void handleSignOut()}
              className={cn(
                "flex w-full min-h-[36px] cursor-pointer items-center gap-2 rounded-xl px-3 py-2",
                "text-sm font-medium text-error hover:bg-error/10 transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error/40",
                "disabled:cursor-not-allowed disabled:opacity-60",
              )}
            >
              <LogOutIcon className="size-4 shrink-0" />
              {isSigningOut ? "Signing out…" : "Sign out"}
            </button>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/* ─── Main TopNav component ───────────────────────────────────────────── */

export function TopNav({ role, userName, resultsPublished, hasTeam }: TopNavProps) {
  const pathname   = usePathname();
  const [open, setOpen] = useState(false);
  const [previousPathname, setPreviousPathname] = useState(pathname);
  if (pathname !== previousPathname) {
    setPreviousPathname(pathname);
    setOpen(false);
  }
  const navLinks = getNavLinks(role, hasTeam, resultsPublished);

  return (
    <>
      {/* ── Sticky header ─────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 w-full border-b border-border bg-surface/90 backdrop-blur-md">
        <div className="mx-auto grid h-16 max-w-7xl grid-cols-[1fr_auto_1fr] items-center gap-4 px-4 sm:px-6">

          {/* Logo */}
          <Link
            href="/"
            className="shrink-0 whitespace-nowrap text-xl font-bold tracking-tight text-deep transition-colors hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded-lg md:text-2xl"
          >
            <span className="text-primary">Utkrishta</span>
            <span className="text-sm font-medium text-muted md:text-base"> · PS Bid Wars</span>
          </Link>

          {/* Desktop nav links */}
          <nav
            aria-label="Main navigation"
            className="hidden items-center gap-6 md:flex md:gap-8"
          >
            {navLinks.map((link) => (
              <NavItem key={link.href} link={link} pathname={pathname} />
            ))}
          </nav>

          {/* Right section: user menu or sign-in + hamburger */}
          <div className="flex items-center justify-self-end gap-2 shrink-0">
            <div className="hidden items-center gap-2 md:flex">
              {role ? (
                <UserMenu role={role} userName={userName} />
              ) : (
                /* Not logged in — show a compact sign-in button */
                <form action={signInWithGoogle}>
                  <button
                    type="submit"
                    className={cn(
                      "rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white",
                      "hover:bg-primary-hover transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                    )}
                  >
                    Sign in
                  </button>
                </form>
              )}
            </div>

            {/* Hamburger — mobile only */}
            <Dialog.Root open={open} onOpenChange={setOpen}>
              <Dialog.Trigger
                className={cn(
                  "flex size-9 items-center justify-center rounded-xl text-muted md:hidden",
                  "hover:bg-tint hover:text-primary transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                )}
                aria-label="Open navigation menu"
              >
                <MenuIcon className="size-5" />
              </Dialog.Trigger>

              <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-50 bg-deep/30 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />

                <Dialog.Content
                  className={cn(
                    "fixed inset-y-0 right-0 z-50 flex w-[min(320px,100vw)] flex-col bg-surface shadow-card",
                    "data-[state=open]:animate-in data-[state=closed]:animate-out",
                    "data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right",
                    "duration-200",
                  )}
                >
                  <Dialog.Title className="sr-only">Navigation menu</Dialog.Title>

                  {/* Sheet header */}
                  <div className="flex items-center justify-between border-b border-border px-5 py-4">
                    <span className="text-sm font-bold text-deep">
                      <span className="text-primary">Utkrishta</span>
                      <span className="text-muted font-medium"> · PS Bid Wars</span>
                    </span>
                    <Dialog.Close
                      className={cn(
                        "flex size-8 items-center justify-center rounded-lg text-muted",
                        "hover:bg-tint hover:text-primary transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                      )}
                      aria-label="Close navigation menu"
                    >
                      <XIcon className="size-4" />
                    </Dialog.Close>
                  </div>

                  {/* Sheet nav links */}
                  <nav
                    aria-label="Mobile navigation"
                    className="space-y-1 overflow-y-auto px-3 py-4"
                  >
                    {navLinks.map((link) => (
                      <MobileNavItem
                        key={link.href}
                        link={link}
                        pathname={pathname}
                        onNavigate={() => setOpen(false)}
                      />
                    ))}
                  </nav>

                  {/* Sheet footer: theme slot and account control */}
                  <div className="mt-auto border-t border-border px-4 py-4">
                    {role ? (
                      <UserMenu role={role} userName={userName} />
                    ) : (
                      <form action={signInWithGoogle} className="w-full">
                        <button
                          type="submit"
                          className={cn(
                            "flex min-h-11 w-full items-center justify-center rounded-xl bg-primary",
                            "text-sm font-semibold text-white hover:bg-primary-hover transition-colors",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                          )}
                        >
                          Sign in with Google
                        </button>
                      </form>
                    )}
                  </div>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
          </div>
        </div>
      </header>
    </>
  );
}
