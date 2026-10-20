import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { checkOrigin, isValidObjectId } from "@/lib/admin-auth";
import { connectToDatabase } from "@/lib/db";
import { checkScoreSubmissionRateLimit } from "@/lib/rate-limit";
import { getRoleForEmail, normalizeEmail } from "@/lib/roles";
import { AuditLog } from "@/models/AuditLog";
import { Round } from "@/models/Round";
import { Score } from "@/models/Score";
import { Team } from "@/models/Team";
import { User } from "@/models/User";

const schema = z.object({ teamId: z.string().regex(/^[0-9a-f]{24}$/i), criterionScores: z.array(z.number().int().min(0)).max(20) }).strict();
type Params = { params: Promise<{ roundId: string }> };
export async function PUT(request: Request, { params }: Params) {
  if (!checkOrigin(request)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  const { roundId } = await params;
  if (!isValidObjectId(roundId)) return NextResponse.json({ error: "Invalid round ID." }, { status: 400 });
  try {
    await connectToDatabase(); const rawEmail = (await auth())?.user?.email;
    if (!rawEmail) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    const email = normalizeEmail(rawEmail);
    if (await getRoleForEmail(email) !== "judge") return NextResponse.json({ error: "Only assigned judges can submit scores." }, { status: 403 });
    const actor = await User.findOne({ email }).select({ _id: 1 }).lean<{ _id: mongoose.Types.ObjectId } | null>();
    const limited = await checkScoreSubmissionRateLimit(`${email}:${request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"}`);
    if (!limited.allowed) return NextResponse.json({ error: "Too many score submissions." }, { status: 429 });
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Scores must be whole numbers with a valid team." }, { status: 400 });
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const [round, team] = await Promise.all([Round.findById(roundId).session(session), Team.findOne({ _id: parsed.data.teamId, pointsGiven: true }).session(session)]);
        if (!round || !team) throw new ScoreError("Round or participating team not found.", 404);
        if (round.status !== "open") throw new ScoreError("This round is not open for scoring.", 409);
        if (!round.assignedJudgeEmails.includes(email)) throw new ScoreError("You are not assigned to this round.", 403);
        if (parsed.data.criterionScores.length !== round.criteria.length) throw new ScoreError("Provide a score for every criterion.", 400);
        if (parsed.data.criterionScores.some((points, index) => points > round.criteria[index].maxPoints)) throw new ScoreError("A criterion score exceeds its maximum.", 400);
        const points = parsed.data.criterionScores.reduce((sum, value) => sum + value, 0);
        const criterionScores = (round.criteria as Array<{ name: string; maxPoints: number }>).map((criterion, index) => ({ criterionName: criterion.name, points: parsed.data.criterionScores[index] }));
        const existing = await Score.findOne({ roundId: round._id, judgeEmail: email, teamId: team._id }).session(session);
        const previousValue = existing ? { points: existing.points, criterionScores: existing.criterionScores } : null;
        if (existing) { existing.points = points; existing.criterionScores = criterionScores; await existing.save({ session }); }
        else await Score.create([{ roundId: round._id, judgeEmail: email, teamId: team._id, points, criterionScores }], { session });
        await AuditLog.create([{ action: existing ? "score.changed" : "score.submitted", actorUserId: actor?._id ?? null, targetType: "Score", targetId: existing?._id ?? null, previousValue, newValue: { roundId, teamId: String(team._id), points, criterionScores } }], { session });
      });
    } finally { await session.endSession(); }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ScoreError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Invalid score request." }, { status: 400 });
    console.error("Failed to submit score", error); return NextResponse.json({ error: "Unable to save score." }, { status: 500 });
  }
}
class ScoreError extends Error { constructor(message: string, public readonly status: 400 | 403 | 404 | 409) { super(message); } }
