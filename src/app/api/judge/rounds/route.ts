import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { connectToDatabase } from "@/lib/db";
import { getRoleForEmail, normalizeEmail } from "@/lib/roles";
import { ProblemStatement } from "@/models/ProblemStatement";
import { Round } from "@/models/Round";
import { Score } from "@/models/Score";
import { Team } from "@/models/Team";
import { TeamMember } from "@/models/TeamMember";

export async function GET() {
  try {
    await connectToDatabase();
    const rawEmail = (await auth())?.user?.email;
    if (!rawEmail) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    const email = normalizeEmail(rawEmail);
    if (await getRoleForEmail(email) !== "judge") return NextResponse.json({ error: "Only judges can view the judging workspace." }, { status: 403 });
    const rounds = await Round.find({ assignedJudgeEmails: email }).sort({ order: 1 }).lean();
    const teams = await Team.find({ pointsGiven: true }).select({ name: 1, track: 1, assignedPsId: 1, liveUrl: 1, repoUrl: 1 }).lean();
    const psIds = teams.flatMap((team) => team.assignedPsId ? [team.assignedPsId] : []);
    const [statements, members, scores] = await Promise.all([
      ProblemStatement.find({ _id: { $in: psIds } }).select({ title: 1 }).lean(),
      TeamMember.find({ teamId: { $in: teams.map((team) => team._id) } }).select({ teamId: 1, name: 1 }).lean(),
      Score.find({ judgeEmail: email, roundId: { $in: rounds.map((round) => round._id) } }).select({ roundId: 1, teamId: 1, points: 1, criterionScores: 1 }).lean(),
    ]);
    const titles = new Map(statements.map((statement) => [String(statement._id), statement.title]));
    const names = new Map<string, string[]>();
    for (const member of members) names.set(String(member.teamId), [...(names.get(String(member.teamId)) ?? []), member.name]);
    return NextResponse.json({
      rounds: rounds.map((round) => ({ id: String(round._id), name: round.name, description: round.description, maxPointsPerJudge: round.maxPointsPerJudge, criteria: (round.criteria as Array<{ name: string; maxPoints: number }>).map((criterion) => ({ name: criterion.name, maxPoints: criterion.maxPoints })), status: round.status })),
      teams: teams.map((team) => ({ id: String(team._id), name: team.name, track: team.track, problemStatement: team.assignedPsId ? titles.get(String(team.assignedPsId)) ?? "Not assigned" : "Not assigned", members: names.get(String(team._id)) ?? [], liveUrl: team.liveUrl ?? null, repoUrl: team.repoUrl ?? null, incomplete: !team.liveUrl })),
      scores: scores.map((score) => ({ roundId: String(score.roundId), teamId: String(score.teamId), points: score.points, criterionScores: (score.criterionScores as Array<{ criterionName: string; points: number }>).map((item) => ({ criterionName: item.criterionName, points: item.points })) })),
    });
  } catch (error) { console.error("Failed to load judge workspace", error); return NextResponse.json({ error: "Unable to load judging workspace." }, { status: 500 }); }
}
