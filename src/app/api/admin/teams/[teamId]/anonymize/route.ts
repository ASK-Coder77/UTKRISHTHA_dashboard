import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AdminAuthError, checkOrigin, isValidObjectId, requireAdmin } from "@/lib/admin-auth";
import { connectToDatabase } from "@/lib/db";
import { checkAdminMutationRateLimit } from "@/lib/rate-limit";
import { AuditLog } from "@/models/AuditLog";
import { Team } from "@/models/Team";
import { TeamMember } from "@/models/TeamMember";

type Params = { params: Promise<{ teamId: string }> };
const schema = z.object({ confirmed: z.literal(true) }).strict();
const identifier = (request: Request, email: string) => `${email}:${request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"}`;

export async function POST(request: Request, { params }: Params) {
  if (!checkOrigin(request)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  const { teamId } = await params;
  if (!isValidObjectId(teamId)) return NextResponse.json({ error: "Invalid team ID." }, { status: 400 });
  try {
    await connectToDatabase();
    const actor = await requireAdmin("admin");
    if (!(await checkAdminMutationRateLimit(identifier(request, actor.email))).allowed) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    if (!schema.safeParse(await request.json()).success) return NextResponse.json({ error: "Confirmation is required." }, { status: 400 });

    const session = await mongoose.startSession();
    try {
      let memberCount = 0;
      await session.withTransaction(async () => {
        const team = await Team.findById(teamId).select({ _id: 1 }).session(session).lean<{ _id: mongoose.Types.ObjectId }>();
        if (!team) throw new TeamNotFoundError();
        const members = await TeamMember.find({ teamId: team._id }).select({ _id: 1 }).session(session).lean<Array<{ _id: mongoose.Types.ObjectId }>>();
        memberCount = members.length;
        await Promise.all(members.map((member) => TeamMember.updateOne(
          { _id: member._id },
          { $set: { phone: null, rollNumber: null, normalizedRollNumber: `ANON_${randomUUID()}` } },
          { session },
        )));
        await AuditLog.create([{
          action: "team.personal_data_anonymized",
          actorUserId: actor.userId,
          targetType: "Team",
          targetId: team._id,
          newValue: { phoneAndRollNumbersRemoved: true, memberCount },
        }], { session });
      });
      return NextResponse.json({ anonymizedMembers: memberCount });
    } finally {
      await session.endSession();
    }
  } catch (error) {
    if (error instanceof AdminAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof TeamNotFoundError) return NextResponse.json({ error: "Team not found." }, { status: 404 });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    console.error("Failed to anonymize team personal data", error);
    return NextResponse.json({ error: "Unable to anonymize team personal data." }, { status: 500 });
  }
}

class TeamNotFoundError extends Error {}
