import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AdminAuthError, checkOrigin, isValidObjectId, requireAdmin } from "@/lib/admin-auth";
import { connectToDatabase } from "@/lib/db";
import { checkAdminMutationRateLimit } from "@/lib/rate-limit";
import { AuditLog } from "@/models/AuditLog";
import { CreditRedemption } from "@/models/CreditRedemption";
import { Holding } from "@/models/Holding";
import { ProblemStatement } from "@/models/ProblemStatement";
import { Setting } from "@/models/Setting";
import { Team } from "@/models/Team";

type Params = { params: Promise<{ teamId: string }> };
const schema = z.object({ amount: z.number().int().positive(), reason: z.string().trim().min(1).max(500) }).strict();
const identifier = (request: Request, email: string) => `${email}:${request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"}`;

export async function POST(request: Request, { params }: Params) {
  if (!checkOrigin(request)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  const { teamId } = await params;
  if (!isValidObjectId(teamId)) return NextResponse.json({ error: "Invalid team ID." }, { status: 400 });
  try {
    await connectToDatabase();
    const actor = await requireAdmin("admin");
    if (!(await checkAdminMutationRateLimit(identifier(request, actor.email))).allowed) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "A whole-number amount and reason are required." }, { status: 400 });

    const dbSession = await mongoose.startSession();
    try {
      let balance: number | null = null;
      await dbSession.withTransaction(async () => {
        const settings = await Setting.findOne({ singletonKey: "global" }).select({ redemptionOpen: 1, resultsPublished: 1 }).session(dbSession).lean<{ redemptionOpen: boolean; resultsPublished: boolean }>();
        if (!settings?.redemptionOpen) throw new RedemptionError("redemption_closed");
        if (settings.resultsPublished) throw new RedemptionError("results_published");

        const holding = await Holding.findOne({ teamId }).select({ problemStatementId: 1, amount: 1 }).session(dbSession).lean<{ problemStatementId: mongoose.Types.ObjectId; amount: number }>();
        if (holding && await ProblemStatement.exists({ _id: holding.problemStatementId, status: "live" }).session(dbSession)) throw new RedemptionError("live_holding");
        const minimumBalance = parsed.data.amount + (holding?.amount ?? 0);
        const team = await Team.findOneAndUpdate(
          { _id: teamId, pointsGiven: true, balance: { $gte: minimumBalance } },
          { $inc: { balance: -parsed.data.amount, auctionVersion: 1 } },
          { new: true, session: dbSession },
        ).lean<{ _id: mongoose.Types.ObjectId; balance: number }>();
        if (!team) throw new RedemptionError("insufficient_balance");
        balance = team.balance;
        const previousBalance = team.balance + parsed.data.amount;
        await CreditRedemption.create([{ teamId: team._id, actorUserId: actor.userId, amount: parsed.data.amount, reason: parsed.data.reason, previousBalance, newBalance: team.balance }], { session: dbSession });
        await AuditLog.create([{ action: "team.credits_redeemed", actorUserId: actor.userId, targetType: "Team", targetId: team._id, previousValue: { balance: previousBalance }, newValue: { balance: team.balance, amount: parsed.data.amount, reason: parsed.data.reason } }], { session: dbSession });
      });
      return NextResponse.json({ balance });
    } finally { await dbSession.endSession(); }
  } catch (error) {
    if (error instanceof AdminAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof RedemptionError) {
      const messages = { redemption_closed: "Credit redemption is not open.", results_published: "Credits cannot be redeemed after results are published.", live_holding: "Credits cannot be redeemed while the team holds a live auction spot.", insufficient_balance: "The team does not have enough credits after its standing bid is protected." };
      return NextResponse.json({ error: messages[error.code] }, { status: 409 });
    }
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Invalid redemption data." }, { status: 400 });
    console.error("Failed to redeem credits", error);
    return NextResponse.json({ error: "Unable to redeem credits." }, { status: 500 });
  }
}

class RedemptionError extends Error {
  constructor(public readonly code: "redemption_closed" | "results_published" | "live_holding" | "insufficient_balance") { super(code); }
}
