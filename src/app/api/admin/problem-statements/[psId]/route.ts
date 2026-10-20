import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { z } from "zod";
import { connectToDatabase } from "@/lib/db";
import { AdminAuthError, checkOrigin, isValidObjectId, requireAdmin } from "@/lib/admin-auth";
import { checkAdminMutationRateLimit } from "@/lib/rate-limit";
import { getSettings } from "@/lib/settings";
import { AuditLog } from "@/models/AuditLog";
import { Bid } from "@/models/Bid";
import { Holding } from "@/models/Holding";
import { ProblemStatement } from "@/models/ProblemStatement";
import { Team } from "@/models/Team";

type Params = { params: Promise<{ psId: string }> };

function getIdentifier(request: Request, email: string) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  return `${email}:${ip}`;
}

export async function PATCH(request: Request, { params }: Params) {
  if (!checkOrigin(request)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  const { psId } = await params;
  if (!isValidObjectId(psId)) return NextResponse.json({ error: "Invalid problem statement ID." }, { status: 400 });

  try {
    await connectToDatabase();
    const actor = await requireAdmin("admin");

    const rl = await checkAdminMutationRateLimit(getIdentifier(request, actor.email));
    if (!rl.allowed) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

    const settings = await getSettings();

    const patchSchema = z
      .object({
        title: z.string().trim().min(1).max(300).optional(),
        domain: z.string().trim().min(1).max(80).optional(),
        description: z.string().trim().min(1).max(5000).optional(),
        basePrice: z.number().int().min(1).max(settings.startingPoints).optional(),
        capacity: z.number().int().min(1).optional(),
      })
      .strict()
      .refine((v) => Object.keys(v).length > 0, "At least one field is required.");

    const parsed = patchSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Invalid problem statement data." }, { status: 400 });

    const existing = await ProblemStatement.findById(psId)
      .lean<{ _id: mongoose.Types.ObjectId; title: string; domain?: string; description: string; basePrice: number; capacity: number | null }>();
    if (!existing) {
      return NextResponse.json({ error: "Problem statement not found." }, { status: 404 });
    }

    const updated = await ProblemStatement.findOneAndUpdate(
      { _id: psId },
      { $set: parsed.data },
      { new: true },
    ).lean();
    if (!updated) return NextResponse.json({ error: "Problem statement not found." }, { status: 404 });

    await AuditLog.create([{
      action: "ps.updated",
      actorUserId: actor.userId,
      targetType: "ProblemStatement",
      targetId: existing._id,
      previousValue: Object.fromEntries(
        Object.keys(parsed.data).map((k) => [k, (existing as Record<string, unknown>)[k]]),
      ),
      newValue: parsed.data,
    }]);

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AdminAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Invalid problem statement data." }, { status: 400 });
    console.error("Failed to update problem statement", error);
    return NextResponse.json({ error: "Unable to update problem statement." }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: Params) {
  if (!checkOrigin(request)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  const { psId } = await params;
  if (!isValidObjectId(psId)) return NextResponse.json({ error: "Invalid problem statement ID." }, { status: 400 });

  try {
    await connectToDatabase();
    const actor = await requireAdmin("admin");

    const rl = await checkAdminMutationRateLimit(getIdentifier(request, actor.email));
    if (!rl.allowed) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

    const dbSession = await mongoose.startSession();
    try {
      await dbSession.withTransaction(async () => {
        const problemStatement = await ProblemStatement.findById(psId)
          .select({ title: 1 })
          .session(dbSession)
          .lean<{ _id: mongoose.Types.ObjectId; title: string }>();
        if (!problemStatement) throw new ProblemStatementNotFoundError();

        const [bids, assignedTeams] = await Promise.all([
          Bid.find({ problemStatementId: problemStatement._id })
            .sort({ createdAt: -1, _id: -1 })
            .select({ teamId: 1, amount: 1 })
            .session(dbSession)
            .lean<Array<{ teamId: mongoose.Types.ObjectId; amount: number }>>(),
          Team.find({ assignedPsId: problemStatement._id })
            .select({ _id: 1, assignmentType: 1 })
            .session(dbSession)
            .lean<Array<{ _id: mongoose.Types.ObjectId; assignmentType: "won" | "allocated" | null }>>(),
        ]);
        const finalBids = new Map<string, number>();
        for (const bid of bids) if (!finalBids.has(String(bid.teamId))) finalBids.set(String(bid.teamId), bid.amount);

        let refundedTeams = 0;
        for (const team of assignedTeams) {
          const refund = team.assignmentType === "won" ? finalBids.get(String(team._id)) ?? 0 : 0;
          await Team.updateOne(
            { _id: team._id, assignedPsId: problemStatement._id },
            { $set: { assignedPsId: null, assignmentType: null }, ...(refund ? { $inc: { balance: refund } } : {}) },
            { session: dbSession },
          );
          if (refund) refundedTeams += 1;
        }

        const [holdingResult, bidResult, deleted] = await Promise.all([
          Holding.deleteMany({ problemStatementId: problemStatement._id }, { session: dbSession }),
          Bid.deleteMany({ problemStatementId: problemStatement._id }, { session: dbSession }),
          ProblemStatement.findByIdAndDelete(problemStatement._id, { session: dbSession }),
        ]);
        if (!deleted) throw new ProblemStatementNotFoundError();
        await AuditLog.create([{
          action: "ps.deleted",
          actorUserId: actor.userId,
          targetType: "ProblemStatement",
          targetId: problemStatement._id,
          previousValue: { title: problemStatement.title },
          newValue: { removedBids: bidResult.deletedCount, removedHoldings: holdingResult.deletedCount, clearedAssignments: assignedTeams.length, refundedTeams },
        }], { session: dbSession });
      });
    } finally {
      await dbSession.endSession();
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AdminAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof ProblemStatementNotFoundError) return NextResponse.json({ error: "Problem statement not found." }, { status: 404 });
    console.error("Failed to delete problem statement", error);
    return NextResponse.json({ error: "Unable to delete problem statement." }, { status: 500 });
  }
}

class ProblemStatementNotFoundError extends Error {}
