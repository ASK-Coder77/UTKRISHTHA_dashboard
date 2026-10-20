import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { connectToDatabase } from "@/lib/db";
import { getRoleForEmail, normalizeEmail } from "@/lib/roles";
import { Holding } from "@/models/Holding";
import { ProblemStatement } from "@/models/ProblemStatement";
import { Team } from "@/models/Team";

export async function GET() {
  try {
    await connectToDatabase();
    const session = await auth();
    const rawEmail = session?.user?.email;
    if (!rawEmail) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

    const email = normalizeEmail(rawEmail);
    const role = await getRoleForEmail(email);
    if (role !== "team_leader") {
      // Students / admins / judges get an empty response (no personal team data)
      return NextResponse.json({ holding: null, balance: null });
    }

    const team = await Team.findOne({ leaderEmail: email })
      .select({ balance: 1, assignedPsId: 1, track: 1 })
      .lean<{ _id: unknown; balance: number; assignedPsId: unknown; track: "web_dev" | "ai_ml" }>();
    if (!team) return NextResponse.json({ holding: null, balance: null });

    const holding = await Holding.findOne({ teamId: team._id })
      .select({ problemStatementId: 1, amount: 1 })
      .lean<{ problemStatementId: unknown; amount: number }>();

    const visibleHolding = holding && await ProblemStatement.exists({ _id: holding.problemStatementId, revealed: true, track: team.track }) ? holding : null;
    return NextResponse.json({
      teamId: String(team._id),
      balance: team.balance,
      assignedPsId: team.assignedPsId ? String(team.assignedPsId) : null,
      holding: visibleHolding
        ? { psId: String(visibleHolding.problemStatementId), amount: visibleHolding.amount }
        : null,
    });
  } catch (error) {
    console.error("Failed to fetch my holding", error);
    return NextResponse.json({ error: "Unable to load your holding." }, { status: 500 });
  }
}
