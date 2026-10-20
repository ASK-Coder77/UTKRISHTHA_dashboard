"use server";
/**
 * Shared server actions for sign-in / sign-out.
 *
 * Defined in a "use server" module so they can be imported by both Server
 * Components (page.tsx) and Client Components (top-nav.tsx) alike.
 * Next.js serialises the action reference for the client automatically.
 */
import { signIn, signOut } from "@/auth";

export async function signInWithGoogle() {
  await signIn("google", { redirectTo: "/" });
}

/** Hero-only registration entry point. Navbar sign-in continues to return home. */
export async function registerWithGoogle() {
  await signIn("google", { redirectTo: "/register-team" });
}

export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}
