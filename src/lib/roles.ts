import { AdminAllowlist } from "@/models/AdminAllowlist";
import { JudgeAllowlist } from "@/models/JudgeAllowlist";
import { Setting } from "@/models/Setting";
import { connectToDatabase } from "@/lib/db";

export type AppRole = "super_admin" | "admin" | "judge" | "team_leader" | "student";

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isAllowedDomain(email: string) {
  const normalizedEmail = normalizeEmail(email);
  const separator = normalizedEmail.lastIndexOf("@");
  const domain = process.env.ALLOWED_EMAIL_DOMAIN?.trim().toLowerCase();
  return Boolean(domain && separator > 0 && normalizedEmail.slice(separator + 1) === domain);
}

export function getSuperAdminEmails() {
  return (process.env.ADMIN_EMAILS ?? "").split(",").map(normalizeEmail).filter(Boolean);
}

export async function getRoleForEmail(email: string): Promise<AppRole> {
  const normalizedEmail = normalizeEmail(email);
  if (getSuperAdminEmails().includes(normalizedEmail)) return "super_admin";
  await connectToDatabase();

  const [admin, judge, leader] = await Promise.all([
    AdminAllowlist.exists({ email: normalizedEmail }),
    JudgeAllowlist.exists({ email: normalizedEmail }),
    mongooseTeamLeaderExists(normalizedEmail),
  ]);
  // Conflicting role-family records fail closed instead of granting whichever query wins.
  const roles = [admin, judge, leader].filter(Boolean).length;
  if (roles > 1) return "student";
  if (admin) return "admin";
  if (judge) return "judge";
  if (leader) return "team_leader";
  return "student";
}

async function mongooseTeamLeaderExists(email: string) {
  const mongoose = await import("mongoose");
  const teamSchema = new mongoose.Schema({ leaderEmail: String }, { collection: "teams" });
  const TeamLookup = mongoose.models.TeamRoleLookup ?? mongoose.model("TeamRoleLookup", teamSchema);
  return TeamLookup.exists({ leaderEmail: email });
}

export async function isExternalJudgeAllowed(email: string) {
  await connectToDatabase();
  const setting = await Setting.findOne({}).select({ allowNonCollegeJudges: 1 }).lean<{ allowNonCollegeJudges?: boolean }>();
  if (!setting?.allowNonCollegeJudges) return false;
  return Boolean(await JudgeAllowlist.exists({ email: normalizeEmail(email) }));
}
