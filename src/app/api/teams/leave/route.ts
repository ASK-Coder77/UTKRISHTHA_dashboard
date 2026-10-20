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
    if ((await getRoleForEmail(email)) !== "student") {
      return NextResponse.json({ error: "Team leaders must disband or transfer their team instead of leaving it." }, { status: 403 });
    }
    const rateLimit = await checkTeamRegistrationRateLimit(clientIdentifier(request, email));
    if (!rateLimit.allowed) return NextResponse.json({ error: rateLimit.reason === "limited" ? "Too many team changes. Please try again later." : "Team changes are temporarily unavailable." }, { status: rateLimit.reason === "limited" ? 429 : 503 });

    const dbSession = await mongoose.startSession();
    try {
      await dbSession.withTransaction(async () => {
        const [settings, membership, actor] = await Promise.all([
          getSettings(),
          TeamMember.findOne({ email }).session(dbSession).lean<{ _id: mongoose.Types.ObjectId; teamId: mongoose.Types.ObjectId; name: string }>(),
          User.findOne({ email }).select({ _id: 1 }).session(dbSession).lean<{ _id: mongoose.Types.ObjectId }>(),
        ]);
        if (!settings.registrationOpen) throw new TeamChangeError("Team registration is currently closed.");
        if (!membership) throw new TeamChangeError("You are not a member of a team.");
        const team = await Team.findById(membership.teamId).session(dbSession).lean<{ _id: mongoose.Types.ObjectId; pointsGiven: boolean; assignedPsId: mongoose.Types.ObjectId | null }>();
        if (!team) throw new TeamChangeError("Your team could not be found.");
        const memberCount = await TeamMember.countDocuments({ teamId: team._id }).session(dbSession);
        if (memberCount - 1 < settings.minTeamSize) {
          throw new TeamChangeError(`You cannot leave because your team must have at least ${settings.minTeamSize} members.`);
        }
        const [hasBid, hasHolding] = await Promise.all([
          Bid.exists({ teamId: team._id }).session(dbSession),
          Holding.exists({ teamId: team._id }).session(dbSession),
        ]);
        if (team.pointsGiven || team.assignedPsId || hasBid || hasHolding) throw new TeamChangeError("You can leave only before your team has been given points, placed bids, or received a problem statement.");

        const removed = await TeamMember.findOneAndDelete({ _id: membership._id, email, teamId: team._id }, { session: dbSession });
        if (!removed) throw new TeamChangeError("Your membership changed before it could be removed. Please try again.");
        await AuditLog.create([{
          action: "team.member_left",
          actorUserId: actor?._id ?? null,
          targetType: "Team",
          targetId: team._id,
          previousValue: { memberName: membership.name },
          newValue: null,
        }], { session: dbSession });
      });
    } finally {
      await dbSession.endSession();
    }
    return NextResponse.json({ left: true });
  } catch (error) {
    if (error instanceof TeamChangeError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("Unable to leave team", error);
    return NextResponse.json({ error: "Unable to leave the team. Please try again." }, { status: 500 });
  }
}

class TeamChangeError extends Error {}
