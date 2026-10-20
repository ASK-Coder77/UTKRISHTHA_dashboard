import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import { AdminAuthError, checkOrigin, isValidObjectId, requireAdmin } from "@/lib/admin-auth";
import { checkAdminMutationRateLimit } from "@/lib/rate-limit";
import { getSettings } from "@/lib/settings";
import { AuditLog } from "@/models/AuditLog";
import { ProblemStatement } from "@/models/ProblemStatement";

type Params = { params: Promise<{ psId: string }> };

function getIdentifier(request: Request, email: string) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  return `${email}:${ip}`;
}

export async function POST(request: Request, { params }: Params) {
  if (!checkOrigin(request)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  const { psId } = await params;
  if (!isValidObjectId(psId)) return NextResponse.json({ error: "Invalid problem statement ID." }, { status: 400 });

  try {
    await connectToDatabase();
    const actor = await requireAdmin("admin");

    const rl = await checkAdminMutationRateLimit(getIdentifier(request, actor.email));
    if (!rl.allowed) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

    const settings = await getSettings();

    const ps = await ProblemStatement.findOne({ _id: psId, status: "upcoming", revealed: true })
      .lean<{ _id: mongoose.Types.ObjectId; capacity: number | null }>();
    if (!ps) {
      return NextResponse.json({ error: "Problem statement not found or is not upcoming." }, { status: 409 });
    }

    const effectiveCapacity = ps.capacity ?? settings.defaultTeamsPerPs;
    if (!effectiveCapacity || effectiveCapacity < 1) {
      return NextResponse.json({
        error: "A problem statement must have an effective capacity of at least 1 before it can be opened.",
      }, { status: 400 });
    }

    // Conditional atomic update: only succeeds while still upcoming (prevents double-open race)
    const updated = await ProblemStatement.findOneAndUpdate(
      { _id: psId, status: "upcoming", revealed: true },
      { $set: { status: "live" } },
      { new: true },
    ).lean<{ _id: mongoose.Types.ObjectId }>();

    if (!updated) {
      return NextResponse.json({ error: "Problem statement not found or is not upcoming." }, { status: 409 });
    }

    await AuditLog.create([{
      action: "ps.opened",
      actorUserId: actor.userId,
      targetType: "ProblemStatement",
      targetId: updated._id,
      previousValue: { status: "upcoming" },
      newValue: { status: "live" },
    }]);

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AdminAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Failed to open problem statement", error);
    return NextResponse.json({ error: "Unable to open problem statement." }, { status: 500 });
  }
}
