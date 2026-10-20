import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import { AdminAuthError, checkOrigin, isValidObjectId, requireAdmin } from "@/lib/admin-auth";
import { checkAdminMutationRateLimit } from "@/lib/rate-limit";
import { AuditLog } from "@/models/AuditLog";
import { Setting } from "@/models/Setting";
import { Team } from "@/models/Team";

type Params = { params: Promise<{ teamId: string }> };
type Settings = { startingPoints: number };
type TeamForPoints = { _id: mongoose.Types.ObjectId; balance: number; pointsGiven: boolean };

function identifier(request: Request, email: string) {
  return `${email}:${request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"}`;
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

    const dbSession = await mongoose.startSession();
    try {
      let result: { pointsGiven: boolean; balance: number; changed: boolean } | null = null;
      await dbSession.withTransaction(async () => {
        const [settings, existing] = await Promise.all([
          Setting.findOne({ singletonKey: "global" }).session(dbSession).lean<Settings>(),
          Team.findById(teamId).session(dbSession).lean<TeamForPoints>(),
        ]);
        if (!settings) throw new SettingsNotFoundError();
        if (!existing) throw new TeamNotFoundError();
        if (existing.pointsGiven) {
          result = { pointsGiven: true, balance: existing.balance, changed: false };
          return;
        }
        const updated = await Team.findOneAndUpdate(
          { _id: existing._id, pointsGiven: false },
          { $set: { balance: settings.startingPoints, pointsGiven: true } },
          { new: true, session: dbSession },
        ).lean<TeamForPoints>();
        if (!updated) throw new TeamAlreadyGivenPointsError();
        await AuditLog.create([{
          action: "team.points_given",
          actorUserId: actor.userId,
          targetType: "Team",
          targetId: existing._id,
          previousValue: { balance: existing.balance, pointsGiven: false },
          newValue: { balance: updated.balance, pointsGiven: true },
        }], { session: dbSession });
        result = { pointsGiven: true, balance: updated.balance, changed: true };
      });
      if (!result) throw new Error("No points result");
      return NextResponse.json(result);
    } finally {
      await dbSession.endSession();
    }
  } catch (error) {
    if (error instanceof AdminAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof TeamNotFoundError) return NextResponse.json({ error: "Team not found." }, { status: 404 });
    if (error instanceof SettingsNotFoundError) return NextResponse.json({ error: "Settings not found." }, { status: 500 });
    if (error instanceof TeamAlreadyGivenPointsError) return NextResponse.json({ error: "Points were already given to this team." }, { status: 409 });
    console.error("Failed to give team points", error);
    return NextResponse.json({ error: "Unable to give points." }, { status: 500 });
  }
}

class TeamNotFoundError extends Error {}
class SettingsNotFoundError extends Error {}
class TeamAlreadyGivenPointsError extends Error {}
