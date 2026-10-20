import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AdminAuthError, checkOrigin, requireAdmin } from "@/lib/admin-auth";
import { connectToDatabase } from "@/lib/db";
import { checkAdminMutationRateLimit } from "@/lib/rate-limit";
import { getSuperAdminEmails, isAllowedDomain, normalizeEmail } from "@/lib/roles";
import { AdminAllowlist } from "@/models/AdminAllowlist";
import { AuditLog } from "@/models/AuditLog";
import { JudgeAllowlist } from "@/models/JudgeAllowlist";
import { Setting } from "@/models/Setting";
import { Team } from "@/models/Team";
import { TeamMember } from "@/models/TeamMember";

const emailSchema = z.string().trim().email().max(254);
const mutationSchema = z.object({ role: z.enum(["admin", "judge"]), email: emailSchema }).strict();

function identifier(request: Request, email: string) {
  return `${email}:${request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"}`;
}

function maskedEmail(email: string) {
  const at = email.lastIndexOf("@");
  if (at < 1) return "[redacted]";
  return `${email[0]}***@${email.slice(at + 1)}`;
}

async function authorize(request: Request, mutate: boolean) {
  if (mutate && !checkOrigin(request)) throw new OriginError();
  const actor = await requireAdmin("super_admin");
  if (mutate) {
    const limit = await checkAdminMutationRateLimit(identifier(request, actor.email));
    if (!limit.allowed) throw new RateLimitError(limit.reason === "limited" ? 429 : 503);
  }
  return actor;
}

export async function GET(request: Request) {
  try {
    await connectToDatabase();
    await authorize(request, false);
    const [admins, judges, setting] = await Promise.all([
      AdminAllowlist.find({}).sort({ email: 1 }).select({ email: 1, createdAt: 1 }).lean<Array<{ email: string; createdAt: Date }>>(),
      JudgeAllowlist.find({}).sort({ email: 1 }).select({ email: 1, createdAt: 1 }).lean<Array<{ email: string; createdAt: Date }>>(),
      Setting.findOne({ singletonKey: "global" }).select({ allowNonCollegeJudges: 1 }).lean<{ allowNonCollegeJudges: boolean } | null>(),
    ]);
    return NextResponse.json({
      admins: admins.map((entry) => ({ email: entry.email, addedAt: entry.createdAt.toISOString() })),
      judges: judges.map((entry) => ({ email: entry.email, collegeEmail: isAllowedDomain(entry.email), addedAt: entry.createdAt.toISOString() })),
      allowNonCollegeJudges: setting?.allowNonCollegeJudges ?? false,
    });
  } catch (error) {
    if (error instanceof AdminAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Failed to list role allowlists", error);
    return NextResponse.json({ error: "Unable to load users." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await connectToDatabase();
    const actor = await authorize(request, true);
    const parsed = mutationSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Enter a valid email and role." }, { status: 400 });
    const email = normalizeEmail(parsed.data.email);
    if (getSuperAdminEmails().includes(email)) return NextResponse.json({ error: "Super-admin accounts cannot be changed here." }, { status: 409 });

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const [existingAdmin, existingJudge, teamMember, teamLeader] = await Promise.all([
          AdminAllowlist.exists({ email }).session(session),
          JudgeAllowlist.exists({ email }).session(session),
          TeamMember.exists({ email }).session(session),
          Team.exists({ leaderEmail: email }).session(session),
        ]);
        if (existingAdmin || existingJudge || teamMember || teamLeader) throw new RoleConflictError();

        if (parsed.data.role === "admin" && !isAllowedDomain(email)) throw new InvalidRoleEmailError();
        if (parsed.data.role === "judge" && !isAllowedDomain(email)) {
          const setting = await Setting.findOne({ singletonKey: "global" }).select({ allowNonCollegeJudges: 1 }).session(session).lean<{ allowNonCollegeJudges: boolean } | null>();
          if (!setting?.allowNonCollegeJudges) throw new ExternalJudgeDisabledError();
        }

        const Model = parsed.data.role === "admin" ? AdminAllowlist : JudgeAllowlist;
        await Model.create([{ email, addedBy: actor.email }], { session });
        await AuditLog.create([{
          action: `user.${parsed.data.role}_granted`,
          actorUserId: actor.userId,
          targetType: "User",
          previousValue: null,
          newValue: { email: maskedEmail(email), role: parsed.data.role },
        }], { session });
      });
    } finally {
      await session.endSession();
    }
    return NextResponse.json({ role: parsed.data.role, email }, { status: 201 });
  } catch (error) {
    if (error instanceof AdminAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof OriginError) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    if (error instanceof RateLimitError) return NextResponse.json({ error: error.status === 429 ? "Too many requests." : "User management is temporarily unavailable." }, { status: error.status });
    if (error instanceof RoleConflictError || (error as { code?: number }).code === 11000) return NextResponse.json({ error: "That account already belongs to a team or has a role." }, { status: 409 });
    if (error instanceof InvalidRoleEmailError) return NextResponse.json({ error: "Admin accounts must use an allowed college email." }, { status: 400 });
    if (error instanceof ExternalJudgeDisabledError) return NextResponse.json({ error: "Non-college judges are currently disabled in settings." }, { status: 400 });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Enter a valid email and role." }, { status: 400 });
    console.error("Failed to grant user role", error);
    return NextResponse.json({ error: "Unable to grant this role." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    await connectToDatabase();
    const actor = await authorize(request, true);
    const parsed = mutationSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Enter a valid email and role." }, { status: 400 });
    const email = normalizeEmail(parsed.data.email);
    if (getSuperAdminEmails().includes(email)) return NextResponse.json({ error: "Super-admin accounts cannot be changed here." }, { status: 409 });

    const session = await mongoose.startSession();
    try {
      let removed = false;
      await session.withTransaction(async () => {
        const Model = parsed.data.role === "admin" ? AdminAllowlist : JudgeAllowlist;
        const record = await Model.findOneAndDelete({ email }, { session }).lean<{ _id: mongoose.Types.ObjectId } | null>();
        if (!record) throw new RoleNotFoundError();
        await AuditLog.create([{
          action: `user.${parsed.data.role}_revoked`,
          actorUserId: actor.userId,
          targetType: "User",
          targetId: record._id,
          previousValue: { email: maskedEmail(email), role: parsed.data.role },
          newValue: null,
        }], { session });
        removed = true;
      });
      return NextResponse.json({ removed });
    } finally {
      await session.endSession();
    }
  } catch (error) {
    if (error instanceof AdminAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof OriginError) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    if (error instanceof RateLimitError) return NextResponse.json({ error: error.status === 429 ? "Too many requests." : "User management is temporarily unavailable." }, { status: error.status });
    if (error instanceof RoleNotFoundError) return NextResponse.json({ error: "That role was not found." }, { status: 404 });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Enter a valid email and role." }, { status: 400 });
    console.error("Failed to revoke user role", error);
    return NextResponse.json({ error: "Unable to revoke this role." }, { status: 500 });
  }
}

class OriginError extends Error {}
class RateLimitError extends Error {
  constructor(public readonly status: 429 | 503) { super("Rate limit check did not allow this request."); }
}
class RoleConflictError extends Error {}
class InvalidRoleEmailError extends Error {}
class ExternalJudgeDisabledError extends Error {}
class RoleNotFoundError extends Error {}
