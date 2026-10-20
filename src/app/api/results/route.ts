import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { connectToDatabase } from "@/lib/db";
import { calculateRankings, calculateRankingsByTrack } from "@/lib/rankings";
import { getRoleForEmail, normalizeEmail } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { ProblemStatement } from "@/models/ProblemStatement";
import { Round } from "@/models/Round";
import { Score } from "@/models/Score";
import { Team } from "@/models/Team";

export async function GET() {
  try {
    await connectToDatabase();
    const rawEmail = (await auth())?.user?.email;
    if (!rawEmail) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

    const role = await getRoleForEmail(normalizeEmail(rawEmail));
    const isAdmin = role === "admin" || role === "super_admin";
    const settings = await getSettings();
    if (!settings.resultsPublished && !isAdmin) {
      return NextResponse.json({ error: "Results have not been published yet." }, { status: 403 });
    }

    const [teams, rounds] = await Promise.all([
      Team.find({ pointsGiven: true }).select({ name: 1, track: 1, assignedPsId: 1, balance: 1, assignmentType: 1 }).lean(),
      Round.find({}).select({ name: 1, order: 1, aggregation: 1, weight: 1 }).sort({ order: 1 }).lean(),
    ]);
    const [statements, scores] = await Promise.all([
      ProblemStatement.find({ _id: { $in: teams.flatMap((team) => (team.assignedPsId ? [team.assignedPsId] : [])) } })
        .select({ title: 1 })
        .lean(),
      Score.find({ teamId: { $in: teams.map((team) => team._id) }, roundId: { $in: rounds.map((round) => round._id) } })
        .select({ roundId: 1, teamId: 1, points: 1 })
        .lean(),
    ]);
    const statementTitles = new Map(statements.map((statement) => [String(statement._id), statement.title]));
    const rankingInput = {
      teams: teams.map((team) => ({
        id: String(team._id),
        name: team.name,
        track: team.track,
        problemStatement: team.assignedPsId ? statementTitles.get(String(team.assignedPsId)) ?? null : null,
        balance: team.balance,
        assignmentType: team.assignmentType,
      })),
      rounds: rounds.map((round) => ({
        id: String(round._id),
        name: round.name,
        order: round.order,
        aggregation: round.aggregation,
        weight: round.weight,
      })),
      scores: scores.map((score) => ({ roundId: String(score.roundId), teamId: String(score.teamId), points: score.points })),
      powerupMultiplier: settings.powerupMultiplier,
      powerupForAllocatedTeams: settings.powerupForAllocatedTeams,
    };
    const results = calculateRankings(rankingInput);

    const byTrack = calculateRankingsByTrack(rankingInput);
    return NextResponse.json({ tracks: byTrack, ...(isAdmin ? { overall: results } : {}), view: settings.resultsPublished ? "published" : "admin_preview" });
  } catch (error) {
    console.error("Unable to calculate results", error);
    return NextResponse.json({ error: "Unable to load results." }, { status: 500 });
  }
}
