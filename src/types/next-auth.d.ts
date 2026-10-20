import type { AppRole } from "@/lib/roles";

declare module "next-auth" {
  interface Session {
    user: NonNullable<Session["user"]> & { role: AppRole };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: AppRole;
  }
}
