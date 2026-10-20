import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { z } from "zod";
import { connectToDatabase } from "@/lib/db";
import { AdminAuthError, checkOrigin, isValidObjectId, requireAdmin } from "@/lib/admin-auth";
import { checkAdminMutationRateLimit } from "@/lib/rate-limit";
import { normalizeEmail } from "@/lib/roles";
import { AuditLog } from "@/models/AuditLog";
import { Team } from "@/models/Team";
import { TeamMember } from "@/models/TeamMember";

const schema = z.object({ newLeaderEmail: z.string().trim().email().max(254) }).strict();
type Params = { params: Promise<{ teamId: string }> };
type TeamForTransfer = { _id: mongoose.Types.ObjectId; leaderEmail: string };

function identifier(request: Request, email: string) {
  return `${email}:${request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"}`;
}

function maskedEmail(email: string) {
  const at = email.lastIndexOf("@");
  return at > 0 ? `${email[0]}***@${email.slice(at + 1)}` : "[redacted email]";
}

export async function POST(request: Request, { params }: Params) {
  if (!checkOrigin(request)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  const { teamId } = await params;
  if (!isValidObjectId(teamId)) return NextResponse.json({ error: "Invalid team ID." }, { status: 400 });

  try {
    await connectToDatabase();
    const actor = await requireAdmin("admin");
    const limit = await checkAdminMutationRateLimit(identifier(request, actor.email));
    if (!limit.allowed) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Invalid new leader email." }, { status: 400 });
    const newLeaderEmail = normalizeEmail(parsed.data.newLeaderEmail);

    const dbSession = await mongoose.startSession();
    try {
      await dbSession.withTransaction(async () => {
        const team = await Team.findById(teamId).session(dbSession).lean<TeamForTransfer>();
        if (!team) throw new TeamNotFoundError();
        if (team.leaderEmail === newLeaderEmail) return;
        const newLeaderIsMember = await TeamMember.exists({ teamId: team._id, email: newLeaderEmail }).session(dbSession);
        if (!newLeaderIsMember) throw new NewLeaderNotMemberError();

        const updated = await Team.findOneAndUpdate(
          { _id: team._id, leaderEmail: team.leaderEmail },
          { $set: { leaderEmail: newLeaderEmail } },
          { new: true, session: dbSession },
        ).lean<TeamForTransfer>();
        if (!updated) throw new TransferConflictError();
        await AuditLog.create([{
          action: "team.leader_transferred",
          actorUserId: actor.userId,
          targetType: "Team",
          targetId: team._id,
          previousValue: { leaderEmail: maskedEmail(team.leaderEmail) },
          newValue: { leaderEmail: maskedEmail(newLeaderEmail) },
        }], { session: dbSession });
      });
      return NextResponse.json({ leaderEmail: newLeaderEmail });
    } finally {
      await dbSession.endSession();
    }
  } catch (error) {
    if (error instanceof AdminAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof TeamNotFoundError) return NextResponse.json({ error: "Team not found." }, { status: 404 });
    if (error instanceof NewLeaderNotMemberError) return NextResponse.json({ error: "The new leader must already be a member of this team." }, { status: 400 });
    if (error instanceof TransferConflictError || (error as { code?: number }).code === 11000) return NextResponse.json({ error: "Leadership changed concurrently. Please try again." }, { status: 409 });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Invalid new leader email." }, { status: 400 });
    console.error("Failed to transfer team leadership", error);
    return NextResponse.json({ error: "Unable to transfer leadership." }, { status: 500 });
  }
}

class TeamNotFoundError extends Error {}
class NewLeaderNotMemberError extends Error {}
class TransferConflictError extends Error {}
