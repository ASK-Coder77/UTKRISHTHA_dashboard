import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

const authConfig = {
  providers: [Google],
  session: { strategy: "jwt" },
  pages: { signIn: "/" },
  callbacks: {
    session({ session, token }) {
      if (session.user && typeof token.email === "string") {
        session.user.email = token.email;
        session.user.role = typeof token.role === "string" ? (token.role as import("@/lib/roles").AppRole) : "student";
      }
      return session;
    },
  },
} satisfies NextAuthConfig;

export default authConfig;
