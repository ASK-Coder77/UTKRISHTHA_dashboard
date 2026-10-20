import NextAuth from "next-auth";
import authConfig from "@/auth.config";
import { connectToDatabase } from "@/lib/db";
import { getRoleForEmail, isAllowedDomain, isExternalJudgeAllowed, normalizeEmail } from "@/lib/roles";
import { checkLoginRateLimit } from "@/lib/rate-limit";
import { User } from "@/models/User";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  trustHost: true,
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, profile }) {
      const rawEmail = user.email;
      const verified = profile && "email_verified" in profile && profile.email_verified === true;
      if (!rawEmail || !verified) return false;
      const email = normalizeEmail(rawEmail);
      if (!email.includes("@")) return false;
      const loginLimit = await checkLoginRateLimit(email);
      if (!loginLimit.allowed) return false;
      if (!isAllowedDomain(email) && !(await isExternalJudgeAllowed(email))) return false;
      const role = await getRoleForEmail(email);
      if (!isAllowedDomain(email) && role !== "judge") return false;
      await connectToDatabase();
      await User.findOneAndUpdate(
        { email },
        { $set: { name: user.name ?? "", image: user.image ?? "", lastLoginAt: new Date() } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      return true;
    },
    async jwt({ token, user }) {
      if (user?.email) token.email = normalizeEmail(user.email);
      if (typeof token.email !== "string") return null;

      const email = normalizeEmail(token.email);
      if (!isAllowedDomain(email)) {
        // External accounts are valid only while they remain allowlisted judges.
        // Returning null clears a previously issued JWT after that access is revoked.
        if (!(await isExternalJudgeAllowed(email))) return null;
        if ((await getRoleForEmail(email)) !== "judge") return null;
        token.role = "judge";
        return token;
      }

      token.role = await getRoleForEmail(email);
      return token;
    },
  },
});
