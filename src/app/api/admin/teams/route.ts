import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import { AdminAuthError, requireAdmin } from "@/lib/admin-auth";
import { Team } from "@/models/Team";
import { TeamMember } from "@/models/TeamMember";
import { ProblemStatement } from "@/models/ProblemStatement";

type TeamSummary = {
  _id: { toString(): string };
  name: string;
  leaderEmail: string;
  track: "web_dev" | "ai_ml";
  previousHackathonExperience: "none" | "1-2" | "3_or_more" | null;
  githubUrl: string | null;
  linkedinUrl: string | null;
  rulesAcceptedAt?: Date | null;
  balance: number;
  pointsGiven: boolean;
  assignedPsId: { toString(): string } | null;
  assignmentType: "won" | "allocated" | null;
  createdAt: Date;
};

type MemberSummary = { teamId: { toString(): string }; name: string; email: string; phone: string | null; rollNumber: string; year: string; branch: string };
type ProblemStatementSummary = { _id: { toString(): string }; title: string };

export async function GET() {
  try {
    await connectToDatabase();
    await requireAdmin("admin");

    const teams = await Team.find({})
      .sort({ createdAt: -1, _id: -1 })
      .lean<TeamSummary[]>();
    const [members, problemStatements] = await Promise.all([
      TeamMember.find({ teamId: { $in: teams.map((team) => team._id) } })
        .sort({ name: 1, _id: 1 })
        .lean<MemberSummary[]>(),
      ProblemStatement.find({ _id: { $in: teams.flatMap((team) => (team.assignedPsId ? [team.assignedPsId] : [])) } })
        .select({ title: 1 })
        .lean<ProblemStatementSummary[]>(),
    ]);

    const membersByTeam = new Map<string, MemberSummary[]>();
    for (const member of members) {
      const key = String(member.teamId);
      membersByTeam.set(key, [...(membersByTeam.get(key) ?? []), member]);
    }
    const psTitles = new Map(problemStatements.map((ps) => [String(ps._id), ps.title]));

    return NextResponse.json({
      teams: teams.map((team) => ({
        id: String(team._id),
        name: team.name,
        leaderEmail: team.leaderEmail,
        track: team.track,
        previousHackathonExperience: team.previousHackathonExperience,
        githubUrl: team.githubUrl,
        linkedinUrl: team.linkedinUrl,
        rulesAcceptedAt: team.rulesAcceptedAt?.toISOString() ?? null,
        balance: team.balance,
        pointsGiven: team.pointsGiven,
        assignment: team.assignedPsId
          ? { problemStatementId: String(team.assignedPsId), title: psTitles.get(String(team.assignedPsId)) ?? null, type: team.assignmentType }
          : null,
        members: (membersByTeam.get(String(team._id)) ?? []).map((member) => ({ name: member.name, email: member.email, phone: member.phone, rollNumber: member.rollNumber, year: member.year, branch: member.branch })),
        createdAt: team.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    if (error instanceof AdminAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Failed to list teams", error);
    return NextResponse.json({ error: "Unable to load teams." }, { status: 500 });
  }
}
