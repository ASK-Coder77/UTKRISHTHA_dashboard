import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { checkOrigin } from "@/lib/admin-auth";
import { connectToDatabase } from "@/lib/db";
import { checkTeamRegistrationRateLimit } from "@/lib/rate-limit";
import { getRoleForEmail, normalizeEmail } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { AuditLog } from "@/models/AuditLog";
import { Bid } from "@/models/Bid";
import { Holding } from "@/models/Holding";
import { Team } from "@/models/Team";
import { TeamMember } from "@/models/TeamMember";
import { User } from "@/models/User";

function clientIdentifier(request: Request, email: string) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const ip = forwardedFor?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  return `${email}:${ip}`;
}

export async function DELETE(request: Request) {
  if (!checkOrigin(request)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  try {
    await connectToDatabase();
    const rawEmail = (await auth())?.user?.email;
    if (!rawEmail) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    const email = normalizeEmail(rawEmail);
    if ((await getRoleForEmail(email)) !== "team_leader") {
      return NextResponse.json({ error: "Only a team leader can disband their team." }, { status: 403 });
    }
    const rateLimit = await checkTeamRegistrationRateLimit(clientIdentifier(request, email));
    if (!rateLimit.allowed) return NextResponse.json({ error: rateLimit.reason === "limited" ? "Too many team changes. Please try again later." : "Team changes are temporarily unavailable." }, { status: rateLimit.reason === "limited" ? 429 : 503 });

    const dbSession = await mongoose.startSession();
    try {
      await dbSession.withTransaction(async () => {
        const [settings, team, actor] = await Promise.all([
          getSettings(),
          Team.findOne({ leaderEmail: email }).session(dbSession).lean<{ _id: mongoose.Types.ObjectId; name: string; pointsGiven: boolean; assignedPsId: mongoose.Types.ObjectId | null }>(),
          User.findOne({ email }).select({ _id: 1 }).session(dbSession).lean<{ _id: mongoose.Types.ObjectId }>(),
        ]);
        if (!settings.registrationOpen) throw new TeamChangeError("Team registration is currently closed.");
        if (!team) throw new TeamChangeError("Your team could not be found.");
        const [hasBid, hasHolding] = await Promise.all([
          Bid.exists({ teamId: team._id }).session(dbSession),
          Holding.exists({ teamId: team._id }).session(dbSession),
        ]);
        if (team.pointsGiven || team.assignedPsId || hasBid || hasHolding) throw new TeamChangeError("A team can be disbanded only before it has been given points, placed bids, or received a problem statement.");

        const deleted = await Team.findOneAndDelete({ _id: team._id, leaderEmail: email, pointsGiven: false, assignedPsId: null }, { session: dbSession });
        if (!deleted) throw new TeamChangeError("Your team changed before it could be disbanded. Please try again.");
        await TeamMember.deleteMany({ teamId: team._id }, { session: dbSession });
        await AuditLog.create([{
          action: "team.disbanded_by_leader",
          actorUserId: actor?._id ?? null,
          targetType: "Team",
          targetId: team._id,
          previousValue: { name: team.name },
          newValue: null,
        }], { session: dbSession });
      });
    } finally {
      await dbSession.endSession();
    }
    return NextResponse.json({ disbanded: true });
  } catch (error) {
    if (error instanceof TeamChangeError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("Unable to disband team", error);
    return NextResponse.json({ error: "Unable to disband the team. Please try again." }, { status: 500 });
  }
}

class TeamChangeError extends Error {}
