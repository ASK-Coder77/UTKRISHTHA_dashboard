import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { connectToDatabase } from "@/lib/db";
import { ProblemStatement } from "@/models/ProblemStatement";
import { getRoleForEmail, normalizeEmail } from "@/lib/roles";
import { Team } from "@/models/Team";
import { TeamMember } from "@/models/TeamMember";

export async function GET() {
  try {
    await connectToDatabase();
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const email = normalizeEmail(session.user.email);
    const role = await getRoleForEmail(email);
    const membership = role === "student" ? await TeamMember.findOne({ email }).select({ teamId: 1 }).lean<{ teamId: unknown }>() : null;
    const team = role === "team_leader"
      ? await Team.findOne({ leaderEmail: email }).select({ track: 1 }).lean<{ track: "web_dev" | "ai_ml" }>()
      : membership ? await Team.findById(membership.teamId).select({ track: 1 }).lean<{ track: "web_dev" | "ai_ml" }>() : null;
    const filter = role === "admin" || role === "super_admin" ? {} : team ? { revealed: true, track: team.track } : { _id: null };
    const psList = await ProblemStatement.find(filter).sort({ createdAt: 1 }).lean();
    return NextResponse.json({
      problemStatements: psList.map((ps) => ({
        id: String(ps._id),
        title: ps.title,
        domain: ps.domain ?? "General",
        track: ps.track,
        description: ps.description,
        basePrice: ps.basePrice,
        capacity: ps.capacity,
        status: ps.status,
        auctionOutcome: ps.auctionOutcome,
        revealed: ps.revealed,
      })),
    });
  } catch (error) {
    console.error("Failed to fetch problem statements", error);
    return NextResponse.json({ error: "Unable to load problem statements." }, { status: 500 });
  }
}
