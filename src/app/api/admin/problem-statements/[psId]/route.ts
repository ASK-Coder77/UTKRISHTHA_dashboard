import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { z } from "zod";
import { connectToDatabase } from "@/lib/db";
import { AdminAuthError, checkOrigin, isValidObjectId, requireAdmin } from "@/lib/admin-auth";
import { checkAdminMutationRateLimit } from "@/lib/rate-limit";
import { getSettings } from "@/lib/settings";
import { AuditLog } from "@/models/AuditLog";
import { Bid } from "@/models/Bid";
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

    // Only upcoming PS with no bids and no assigned teams may be edited
    const existing = await ProblemStatement.findOne({ _id: psId, status: "upcoming" })
      .lean<{ _id: mongoose.Types.ObjectId; title: string; domain?: string; description: string; basePrice: number; capacity: number | null }>();
    if (!existing) {
      return NextResponse.json({ error: "Problem statement not found or is not upcoming." }, { status: 409 });
    }

    const [hasBids, hasTeams] = await Promise.all([
      Bid.exists({ problemStatementId: existing._id }),
      Team.exists({ assignedPsId: existing._id }),
    ]);
    if (hasBids || hasTeams) {
      return NextResponse.json({ error: "Cannot edit a problem statement that has bids or assigned teams." }, { status: 409 });
    }

    const updated = await ProblemStatement.findOneAndUpdate(
      { _id: psId, status: "upcoming" },
      { $set: parsed.data },
      { new: true },
    ).lean();
    if (!updated) return NextResponse.json({ error: "Problem statement not found or is not upcoming." }, { status: 409 });

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

    const existing = await ProblemStatement.findOne({ _id: psId, status: "upcoming" })
      .lean<{ _id: mongoose.Types.ObjectId; title: string }>();
    if (!existing) {
      return NextResponse.json({ error: "Problem statement not found or is not upcoming." }, { status: 409 });
    }

    const [hasBids, hasTeams] = await Promise.all([
      Bid.exists({ problemStatementId: existing._id }),
      Team.exists({ assignedPsId: existing._id }),
    ]);
    if (hasBids || hasTeams) {
      return NextResponse.json({
        error: "Cannot delete a problem statement that has bids or assigned teams.",
      }, { status: 409 });
    }

    const deleted = await ProblemStatement.findOneAndDelete({ _id: psId, status: "upcoming" }).lean<{ title: string }>();
    if (!deleted) return NextResponse.json({ error: "Problem statement not found or is not upcoming." }, { status: 409 });

    await AuditLog.create([{
      action: "ps.deleted",
      actorUserId: actor.userId,
      targetType: "ProblemStatement",
      targetId: psId,
      previousValue: { title: deleted.title },
    }]);

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AdminAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Failed to delete problem statement", error);
    return NextResponse.json({ error: "Unable to delete problem statement." }, { status: 500 });
  }
}
