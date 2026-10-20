import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import { AdminAuthError, checkOrigin, requireAdmin } from "@/lib/admin-auth";
import { checkAdminMutationRateLimit } from "@/lib/rate-limit";
import { AuditLog } from "@/models/AuditLog";
import { Setting } from "@/models/Setting";
import { Team } from "@/models/Team";

type Settings = { startingPoints: number };
type TeamForPoints = { _id: mongoose.Types.ObjectId; balance: number };

function identifier(request: Request, email: string) {
  return `${email}:${request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"}`;
}

export async function POST(request: Request) {
  if (!checkOrigin(request)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  try {
    await connectToDatabase();
    const actor = await requireAdmin("admin");
    const limit = await checkAdminMutationRateLimit(identifier(request, actor.email));
    if (!limit.allowed) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

    const dbSession = await mongoose.startSession();
    try {
      let updatedCount = 0;
      await dbSession.withTransaction(async () => {
        const settings = await Setting.findOne({ singletonKey: "global" }).session(dbSession).lean<Settings>();
        if (!settings) throw new SettingsNotFoundError();
        const teams = await Team.find({ pointsGiven: false }).sort({ _id: 1 }).session(dbSession).lean<TeamForPoints[]>();

        for (const team of teams) {
          const updated = await Team.findOneAndUpdate(
            { _id: team._id, pointsGiven: false },
            { $set: { balance: settings.startingPoints, pointsGiven: true } },
            { new: true, session: dbSession },
          ).lean<TeamForPoints>();
          if (!updated) continue;
          await AuditLog.create([{
            action: "team.points_given",
            actorUserId: actor.userId,
            targetType: "Team",
            targetId: team._id,
            previousValue: { balance: team.balance, pointsGiven: false },
            newValue: { balance: updated.balance, pointsGiven: true, bulk: true },
          }], { session: dbSession });
          updatedCount += 1;
        }
      });
      return NextResponse.json({ updatedCount });
    } finally {
      await dbSession.endSession();
    }
  } catch (error) {
    if (error instanceof AdminAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof SettingsNotFoundError) return NextResponse.json({ error: "Settings not found." }, { status: 500 });
    console.error("Failed to give points to teams", error);
    return NextResponse.json({ error: "Unable to give points to teams." }, { status: 500 });
  }
}

class SettingsNotFoundError extends Error {}
