import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { checkOrigin } from "@/lib/admin-auth";
import { connectToDatabase } from "@/lib/db";
import { checkTeamRegistrationRateLimit } from "@/lib/rate-limit";
import { getRoleForEmail, normalizeEmail } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { AuditLog } from "@/models/AuditLog";
import { Team } from "@/models/Team";
import { User } from "@/models/User";
import { Round } from "@/models/Round";

const httpsUrl = z.string().trim().url().max(300).refine((value) => new URL(value).protocol === "https:");
const schema = z.object({ liveUrl: httpsUrl, repoUrl: httpsUrl.optional().nullable() }).strict();

function identifier(request: Request, email: string) {
  return `${email}:${request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"}`;
}

export async function PUT(request: Request) {
  if (!checkOrigin(request)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  try {
    await connectToDatabase();
    const rawEmail = (await auth())?.user?.email;
    if (!rawEmail) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    const email = normalizeEmail(rawEmail);
    if (await getRoleForEmail(email) !== "team_leader") return NextResponse.json({ error: "Only a team leader can save a submission." }, { status: 403 });
    const limited = await checkTeamRegistrationRateLimit(identifier(request, email));
    if (!limited.allowed) return NextResponse.json({ error: limited.reason === "limited" ? "Too many requests." : "Submissions are temporarily unavailable." }, { status: limited.reason === "limited" ? 429 : 503 });
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Use valid HTTPS submission URLs up to 300 characters." }, { status: 400 });
    if (!(await getSettings()).submissionsOpen) return NextResponse.json({ error: "Final submissions are not open." }, { status: 403 });
    const actor = await User.findOne({ email }).select({ _id: 1 }).lean<{ _id: mongoose.Types.ObjectId } | null>();
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        if (await Round.exists({ status: { $in: ["open", "closed"] } }).session(session)) {
          throw new SubmissionError("Submission links cannot change once judging has started.", 409);
        }
        const team = await Team.findOne({ leaderEmail: email }).session(session);
        if (!team) throw new SubmissionError("Team not found.", 404);
        const previousValue = { liveUrl: team.liveUrl, repoUrl: team.repoUrl };
        team.liveUrl = parsed.data.liveUrl;
        team.repoUrl = parsed.data.repoUrl ?? null;
        await team.save({ session });
        await AuditLog.create([{ action: "team.submission_saved", actorUserId: actor?._id ?? null, targetType: "Team", targetId: team._id, previousValue, newValue: { liveUrl: team.liveUrl, repoUrl: team.repoUrl } }], { session });
      });
    } finally { await session.endSession(); }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof SubmissionError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Invalid submission request." }, { status: 400 });
    console.error("Failed to save team submission", error);
    return NextResponse.json({ error: "Unable to save submission." }, { status: 500 });
  }
}

class SubmissionError extends Error { constructor(message: string, public readonly status: 404 | 409) { super(message); } }
