import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AdminAuthError, checkOrigin, isValidObjectId, requireAdmin } from "@/lib/admin-auth";
import { connectToDatabase } from "@/lib/db";
import { checkAdminMutationRateLimit } from "@/lib/rate-limit";
import { AuditLog } from "@/models/AuditLog";
import { Round } from "@/models/Round";
import { Score } from "@/models/Score";
import { Team } from "@/models/Team";

const schema = z.object({ status: z.enum(["open", "closed", "upcoming"]), force: z.boolean().optional() }).strict();
type Params = { params: Promise<{ roundId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  if (!checkOrigin(request)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  const { roundId } = await params;
  if (!isValidObjectId(roundId)) return NextResponse.json({ error: "Invalid round ID." }, { status: 400 });
  try {
    await connectToDatabase();
    const body = schema.safeParse(await request.json());
    if (!body.success) return NextResponse.json({ error: "Invalid round status request." }, { status: 400 });
    const actor = await requireAdmin(body.data.force ? "super_admin" : "admin");
    if (body.data.status === "upcoming" || (body.data.status === "open" && body.data.force)) {
      if (actor.role !== "super_admin") return NextResponse.json({ error: "Only super admins can perform this action." }, { status: 403 });
    }
    const limited = await checkAdminMutationRateLimit(`${actor.email}:${request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"}`);
    if (!limited.allowed) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const round = await Round.findById(roundId).session(session);
        if (!round) throw new StatusError("Round not found.", 404);
        if (round.status === body.data.status) return;
        if (body.data.status === "open") {
          if (round.status === "closed" && actor.role !== "super_admin") throw new StatusError("Only super admins can reopen a closed round.", 403);
          const missingAssignment = await Team.exists({ pointsGiven: true, assignedPsId: null }).session(session);
          if (missingAssignment && !body.data.force) throw new StatusError("Every participating team needs a problem statement before opening a round.", 409);
        } else if (body.data.status === "closed") {
          if (round.status !== "open") throw new StatusError("Only an open round can be closed.", 409);
          const teams = await Team.find({ pointsGiven: true }).select({ _id: 1 }).session(session).lean<Array<{ _id: mongoose.Types.ObjectId }>>();
          const expected = teams.length * round.assignedJudgeEmails.length;
          const count = await Score.countDocuments({ roundId: round._id }).session(session);
          if (count < expected && !body.data.force) throw new StatusError("Every assigned judge must score every participating team before closing.", 409);
        } else throw new StatusError("Rounds cannot be returned to upcoming.", 409);
        const previous = round.status; round.status = body.data.status; await round.save({ session });
        await AuditLog.create([{ action: body.data.force ? "round.status_forced" : "round.status_changed", actorUserId: actor.userId, targetType: "Round", targetId: round._id, previousValue: { status: previous }, newValue: { status: round.status } }], { session });
      });
    } finally { await session.endSession(); }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AdminAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof StatusError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Failed to change round status", error); return NextResponse.json({ error: "Unable to change round status." }, { status: 500 });
  }
}
class StatusError extends Error { constructor(message: string, public readonly status: 403 | 404 | 409) { super(message); } }
