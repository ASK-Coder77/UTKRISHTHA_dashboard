import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AdminAuthError, checkOrigin, isValidObjectId, requireAdmin } from "@/lib/admin-auth";
import { connectToDatabase } from "@/lib/db";
import { checkAdminMutationRateLimit } from "@/lib/rate-limit";
import { AuditLog } from "@/models/AuditLog";
import { Bid } from "@/models/Bid";
import { Holding } from "@/models/Holding";
import { ProblemStatement } from "@/models/ProblemStatement";
import { Round } from "@/models/Round";
import { Score } from "@/models/Score";
import { SETTINGS_SINGLETON_KEY } from "@/lib/settings";
import { Setting } from "@/models/Setting";
import { Team } from "@/models/Team";

type Params = { params: Promise<{ psId: string }> };
const schema = z.object({ confirmed: z.literal(true), confirmationTitle: z.string().min(1) }).strict();
const identifier = (request: Request, email: string) => `${email}:${request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"}`;

export async function POST(request: Request, { params }: Params) {
  if (!checkOrigin(request)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  const { psId } = await params;
  if (!isValidObjectId(psId)) return NextResponse.json({ error: "Invalid problem statement ID." }, { status: 400 });
  try {
    await connectToDatabase();
    const actor = await requireAdmin("super_admin");
    if (!(await checkAdminMutationRateLimit(identifier(request, actor.email))).allowed) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Explicit confirmation and the exact problem statement title are required." }, { status: 400 });

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const problemStatement = await ProblemStatement.findById(psId).select({ title: 1 }).session(session).lean<{ _id: mongoose.Types.ObjectId; title: string }>();
        if (!problemStatement) throw new ProblemStatementNotFoundError();
        if (parsed.data.confirmationTitle !== problemStatement.title) {
          throw new ResetDeleteError("The confirmation title must exactly match the problem statement title.");
        }

        const [settings, openRound, existingScore] = await Promise.all([
          Setting.findOne({ singletonKey: SETTINGS_SINGLETON_KEY }).select({ resultsPublished: 1 }).session(session).lean<{ resultsPublished: boolean }>(),
          Round.exists({ status: "open" }).session(session),
          Score.exists({}).session(session),
        ]);
        if (settings?.resultsPublished) throw new ResetDeleteError("Problem statements cannot be reset and deleted after results are published.");
        if (openRound) throw new ResetDeleteError("Problem statements cannot be reset and deleted while a judging round is open.");
        if (existingScore) throw new ResetDeleteError("Problem statements cannot be reset and deleted after scores have been submitted.");

        const [bids, assignedTeams, holdingResult] = await Promise.all([
          Bid.find({ problemStatementId: problemStatement._id }).sort({ createdAt: -1, _id: -1 }).select({ teamId: 1, amount: 1 }).session(session).lean<Array<{ teamId: mongoose.Types.ObjectId; amount: number }>>(),
          Team.find({ assignedPsId: problemStatement._id }).select({ _id: 1, assignmentType: 1 }).session(session).lean<Array<{ _id: mongoose.Types.ObjectId; assignmentType: "won" | "allocated" | null }>>(),
          Holding.deleteMany({ problemStatementId: problemStatement._id }, { session }),
        ]);
        const finalBids = new Map<string, number>();
        for (const bid of bids) if (!finalBids.has(String(bid.teamId))) finalBids.set(String(bid.teamId), bid.amount);

        let refundedTeams = 0;
        for (const team of assignedTeams) {
          const refund = team.assignmentType === "won" ? finalBids.get(String(team._id)) ?? 0 : 0;
          await Team.updateOne(
            { _id: team._id, assignedPsId: problemStatement._id },
            { $set: { assignedPsId: null, assignmentType: null }, ...(refund ? { $inc: { balance: refund } } : {}) },
            { session },
          );
          if (refund) refundedTeams += 1;
        }
        const bidResult = await Bid.deleteMany({ problemStatementId: problemStatement._id }, { session });
        const deleted = await ProblemStatement.findByIdAndDelete(problemStatement._id, { session });
        if (!deleted) throw new ProblemStatementNotFoundError();
        await AuditLog.create([{
          action: "ps.test_reset_deleted",
          actorUserId: actor.userId,
          targetType: "ProblemStatement",
          targetId: problemStatement._id,
          previousValue: { title: problemStatement.title },
          newValue: { deleted: true, removedBids: bidResult.deletedCount, removedHoldings: holdingResult.deletedCount, clearedAssignments: assignedTeams.length, refundedTeams },
        }], { session });
      });
    } finally {
      await session.endSession();
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AdminAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof ProblemStatementNotFoundError) return NextResponse.json({ error: "Problem statement not found." }, { status: 404 });
    if (error instanceof ResetDeleteError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    console.error("Failed to reset and delete test problem statement", error);
    return NextResponse.json({ error: "Unable to reset and delete the problem statement." }, { status: 500 });
  }
}

class ProblemStatementNotFoundError extends Error {}
class ResetDeleteError extends Error {}
