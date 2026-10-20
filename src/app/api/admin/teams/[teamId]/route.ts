import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import { AdminAuthError, checkOrigin, isValidObjectId, requireAdmin } from "@/lib/admin-auth";
import { checkAdminMutationRateLimit } from "@/lib/rate-limit";
import { AuditLog } from "@/models/AuditLog";
import { Bid } from "@/models/Bid";
import { Team } from "@/models/Team";
import { TeamMember } from "@/models/TeamMember";

type Params = { params: Promise<{ teamId: string }> };

function identifier(request: Request, email: string) {
  return `${email}:${request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"}`;
}

export async function DELETE(request: Request, { params }: Params) {
  if (!checkOrigin(request)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  const { teamId } = await params;
  if (!isValidObjectId(teamId)) return NextResponse.json({ error: "Invalid team ID." }, { status: 400 });

  try {
    await connectToDatabase();
    const actor = await requireAdmin("admin");
    const limit = await checkAdminMutationRateLimit(identifier(request, actor.email));
    if (!limit.allowed) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

    const dbSession = await mongoose.startSession();
    try {
      let deleted = false;
      await dbSession.withTransaction(async () => {
        const team = await Team.findById(teamId).session(dbSession).lean<{ _id: mongoose.Types.ObjectId; name: string; assignedPsId: mongoose.Types.ObjectId | null }>();
        if (!team) throw new TeamNotFoundError();
        if (team.assignedPsId || await Bid.exists({ teamId: team._id }).session(dbSession)) throw new TeamCannotBeDeletedError();

        const removed = await Team.findOneAndDelete({ _id: team._id, assignedPsId: null }, { session: dbSession });
        if (!removed) throw new TeamCannotBeDeletedError();
        await TeamMember.deleteMany({ teamId: team._id }, { session: dbSession });
        await AuditLog.create([{
          action: "team.deleted",
          actorUserId: actor.userId,
          targetType: "Team",
          targetId: team._id,
          previousValue: { name: team.name },
        }], { session: dbSession });
        deleted = true;
      });
      return NextResponse.json({ deleted });
    } finally {
      await dbSession.endSession();
    }
  } catch (error) {
    if (error instanceof AdminAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof TeamNotFoundError) return NextResponse.json({ error: "Team not found." }, { status: 404 });
    if (error instanceof TeamCannotBeDeletedError) return NextResponse.json({ error: "A team with bids or an assigned problem statement cannot be deleted." }, { status: 409 });
    console.error("Failed to delete team", error);
    return NextResponse.json({ error: "Unable to delete team." }, { status: 500 });
  }
}

class TeamNotFoundError extends Error {}
class TeamCannotBeDeletedError extends Error {}
