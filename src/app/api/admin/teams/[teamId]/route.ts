import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { z } from "zod";
import { connectToDatabase } from "@/lib/db";
import { AdminAuthError, checkOrigin, isValidObjectId, requireAdmin } from "@/lib/admin-auth";
import { checkAdminMutationRateLimit } from "@/lib/rate-limit";
import { AuditLog } from "@/models/AuditLog";
import { Bid } from "@/models/Bid";
import { Holding } from "@/models/Holding";
import { Score } from "@/models/Score";
import { Team } from "@/models/Team";
import { TeamMember } from "@/models/TeamMember";

type Params = { params: Promise<{ teamId: string }> };
const updateSchema = z.object({ name: z.string().trim().min(3).max(40).refine((value) => !/[<>]/.test(value)) }).strict();

function identifier(request: Request, email: string) {
  return `${email}:${request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"}`;
}

export async function PATCH(request: Request, { params }: Params) {
  if (!checkOrigin(request)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  const { teamId } = await params;
  if (!isValidObjectId(teamId)) return NextResponse.json({ error: "Invalid team ID." }, { status: 400 });

  try {
    await connectToDatabase();
    const actor = await requireAdmin("admin");
    if (!(await checkAdminMutationRateLimit(identifier(request, actor.email))).allowed) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    const parsed = updateSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Enter a valid team name." }, { status: 400 });

    const normalizedName = parsed.data.name.toLowerCase();
    const dbSession = await mongoose.startSession();
    try {
      await dbSession.withTransaction(async () => {
        const team = await Team.findById(teamId).select({ name: 1 }).session(dbSession).lean<{ _id: mongoose.Types.ObjectId; name: string }>();
        if (!team) throw new TeamNotFoundError();
        const updated = await Team.findOneAndUpdate(
          { _id: team._id },
          { $set: { name: parsed.data.name, normalizedName } },
          { new: true, session: dbSession },
        );
        if (!updated) throw new TeamNotFoundError();
        await AuditLog.create([{
          action: "team.updated",
          actorUserId: actor.userId,
          targetType: "Team",
          targetId: team._id,
          previousValue: { name: team.name },
          newValue: { name: parsed.data.name },
        }], { session: dbSession });
      });
    } finally {
      await dbSession.endSession();
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AdminAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof TeamNotFoundError) return NextResponse.json({ error: "Team not found." }, { status: 404 });
    if ((error as { code?: number }).code === 11000) return NextResponse.json({ error: "A team with that name already exists." }, { status: 409 });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Invalid team data." }, { status: 400 });
    console.error("Failed to update team", error);
    return NextResponse.json({ error: "Unable to update team." }, { status: 500 });
  }
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
        const team = await Team.findById(teamId).session(dbSession).lean<{ _id: mongoose.Types.ObjectId; name: string }>();
        if (!team) throw new TeamNotFoundError();

        const [removed, members, bids, holdings, scores] = await Promise.all([
          Team.findByIdAndDelete(team._id, { session: dbSession }),
          TeamMember.deleteMany({ teamId: team._id }, { session: dbSession }),
          Bid.deleteMany({ teamId: team._id }, { session: dbSession }),
          Holding.deleteMany({ teamId: team._id }, { session: dbSession }),
          Score.deleteMany({ teamId: team._id }, { session: dbSession }),
        ]);
        if (!removed) throw new TeamNotFoundError();
        await AuditLog.create([{
          action: "team.deleted",
          actorUserId: actor.userId,
          targetType: "Team",
          targetId: team._id,
          previousValue: { name: team.name },
          newValue: { removedMembers: members.deletedCount, removedBids: bids.deletedCount, removedHoldings: holdings.deletedCount, removedScores: scores.deletedCount },
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
    console.error("Failed to delete team", error);
    return NextResponse.json({ error: "Unable to delete team." }, { status: 500 });
  }
}

class TeamNotFoundError extends Error {}
