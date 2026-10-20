import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { z } from "zod";
import { connectToDatabase } from "@/lib/db";
import { AdminAuthError, checkOrigin, isValidObjectId, requireAdmin } from "@/lib/admin-auth";
import { checkAdminMutationRateLimit } from "@/lib/rate-limit";
import { AuditLog } from "@/models/AuditLog";
import { Holding } from "@/models/Holding";
import { ProblemStatement } from "@/models/ProblemStatement";
import { Team } from "@/models/Team";

type Params = { params: Promise<{ psId: string }> };

const capacitySchema = z
  .object({ capacity: z.number().int().min(1).nullable() })
  .strict();

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

    const parsed = capacitySchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Invalid capacity value." }, { status: 400 });

    const ps = await ProblemStatement.findById(psId)
      .lean<{ _id: mongoose.Types.ObjectId; capacity: number | null; status: string }>();
    if (!ps) return NextResponse.json({ error: "Problem statement not found." }, { status: 404 });

    // Guard: new capacity must not be below current holders + assigned teams
    if (parsed.data.capacity !== null) {
      const [holdingCount, assignedCount] = await Promise.all([
        Holding.countDocuments({ problemStatementId: ps._id }),
        Team.countDocuments({ assignedPsId: ps._id }),
      ]);
      const usedSeats = holdingCount + assignedCount;
      if (parsed.data.capacity < usedSeats) {
        return NextResponse.json({
          error: `Capacity cannot be less than current holders + assigned teams (${usedSeats}).`,
        }, { status: 400 });
      }
    }

    await ProblemStatement.updateOne({ _id: psId }, { $set: { capacity: parsed.data.capacity } });

    await AuditLog.create([{
      action: "ps.capacity_updated",
      actorUserId: actor.userId,
      targetType: "ProblemStatement",
      targetId: psId,
      previousValue: { capacity: ps.capacity },
      newValue: { capacity: parsed.data.capacity },
    }]);

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AdminAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Invalid capacity value." }, { status: 400 });
    console.error("Failed to update PS capacity", error);
    return NextResponse.json({ error: "Unable to update capacity." }, { status: 500 });
  }
}
