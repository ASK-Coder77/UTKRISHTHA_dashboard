import mongoose from "mongoose";
import { connectToDatabase } from "@/lib/db";
import { getSuperAdminEmails, normalizeEmail } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { AdminAllowlist } from "@/models/AdminAllowlist";
import { AuditLog } from "@/models/AuditLog";
import { Bid } from "@/models/Bid";
import { Holding } from "@/models/Holding";
import { JudgeAllowlist } from "@/models/JudgeAllowlist";
import { ProblemStatement } from "@/models/ProblemStatement";
import { Setting } from "@/models/Setting";
import { Team } from "@/models/Team";
import { User } from "@/models/User";

type PlaceBidInput = {
  teamId: string;
  problemStatementId: string;
  amount: number;
  leaderEmail: string;
};

type CloseAuctionInput = {
  problemStatementId: string;
  actorEmail: string;
};

export type PlaceBidResult = {
  holdingAmount: number;
  displacedTeamId: string | null;
};

export type CloseAuctionResult = {
  status: "closed" | "already_closed";
  outcome: "sold" | "unsold" | null;
  winnerCount: number;
};

type AuctionTeam = {
  _id: mongoose.Types.ObjectId;
  pointsGiven: boolean;
  assignedPsId: mongoose.Types.ObjectId | null;
  balance: number;
  track: "web_dev" | "ai_ml";
};

type AuctionProblemStatement = {
  _id: mongoose.Types.ObjectId;
  basePrice: number;
  capacity: number | null;
  status: "upcoming" | "live" | "closed";
  auctionOutcome: "sold" | "unsold" | null;
  track: "web_dev" | "ai_ml";
  revealed: boolean;
  bidSequence: number;
};

type AuctionSettings = { defaultTeamsPerPs: number | null; minIncrement: number };
type AuctionHolding = {
  _id: mongoose.Types.ObjectId;
  teamId: mongoose.Types.ObjectId;
  problemStatementId: mongoose.Types.ObjectId;
  amount: number;
  sequence: number;
};

export class AuctionError extends Error {
  public readonly code:
    | "invalid_input"
    | "not_team_leader"
    | "not_admin"
    | "problem_statement_not_found"
    | "auction_not_live"
    | "track_mismatch"
    | "already_assigned"
    | "already_holding_other"
    | "bid_below_base_price"
    | "bid_exceeds_balance"
    | "bid_increment_too_small"
    | "missing_capacity"
    | "auction_integrity_error";

  constructor(code: AuctionError["code"]) {
    super(code);
    this.name = "AuctionError";
    this.code = code;
  }
}

function isObjectId(value: string) {
  return mongoose.isObjectIdOrHexString(value);
}

async function getActorUserId(email: string, session: mongoose.ClientSession) {
  const user = await User.findOne({ email }).select({ _id: 1 }).session(session).lean<{ _id: mongoose.Types.ObjectId }>();
  if (!user) throw new AuctionError("auction_integrity_error");
  return user._id;
}

async function verifyTeamLeader(
  teamId: string,
  leaderEmail: string,
  session: mongoose.ClientSession,
) {
  const normalizedEmail = normalizeEmail(leaderEmail);
  const [team, admin, judge] = await Promise.all([
    Team.findOne({ _id: teamId, leaderEmail: normalizedEmail }).session(session).lean<AuctionTeam>(),
    AdminAllowlist.exists({ email: normalizedEmail }).session(session),
    JudgeAllowlist.exists({ email: normalizedEmail }).session(session),
  ]);
  if (!team || admin || judge || getSuperAdminEmails().includes(normalizedEmail)) {
    throw new AuctionError("not_team_leader");
  }
  return team;
}

async function verifyAdmin(actorEmail: string, session: mongoose.ClientSession) {
  const normalizedEmail = normalizeEmail(actorEmail);
  if (getSuperAdminEmails().includes(normalizedEmail)) return;
  const admin = await AdminAllowlist.exists({ email: normalizedEmail }).session(session);
  if (!admin) throw new AuctionError("not_admin");
}

async function lockLiveProblemStatement(problemStatementId: string, session: mongoose.ClientSession): Promise<AuctionProblemStatement> {
  const problemStatement = await ProblemStatement.findOneAndUpdate(
    { _id: problemStatementId, status: "live", revealed: true },
    { $inc: { version: 1, bidSequence: 1 } },
    { new: true, session },
  ).lean<AuctionProblemStatement>();
  if (problemStatement) return problemStatement;

  const existing = await ProblemStatement.exists({ _id: problemStatementId }).session(session);
  if (!existing) throw new AuctionError("problem_statement_not_found");
  throw new AuctionError("auction_not_live");
}

export async function placeBid(input: PlaceBidInput): Promise<PlaceBidResult> {
  if (
    !isObjectId(input.teamId) ||
    !isObjectId(input.problemStatementId) ||
    !Number.isSafeInteger(input.amount) ||
    input.amount < 1
  ) {
    throw new AuctionError("invalid_input");
  }

  await connectToDatabase();
  await getSettings();
  const dbSession = await mongoose.startSession();
  try {
    let result: PlaceBidResult | null = null;
    await dbSession.withTransaction(async () => {
      const [team, problemStatement, settings] = await Promise.all([
        verifyTeamLeader(input.teamId, input.leaderEmail, dbSession),
        lockLiveProblemStatement(input.problemStatementId, dbSession),
        Setting.findOne({ singletonKey: "global" }).session(dbSession).lean<AuctionSettings>(),
      ]);
      if (!settings) throw new AuctionError("auction_integrity_error");
      const lockedTeam = await Team.findOneAndUpdate(
        { _id: team._id, leaderEmail: normalizeEmail(input.leaderEmail) },
        { $inc: { auctionVersion: 1 } },
        { new: true, session: dbSession },
      ).lean<AuctionTeam>();
      if (!lockedTeam) throw new AuctionError("auction_integrity_error");
      if (!lockedTeam.pointsGiven) throw new AuctionError("not_team_leader");
      if (lockedTeam.track !== problemStatement.track) throw new AuctionError("track_mismatch");
      if (lockedTeam.assignedPsId) throw new AuctionError("already_assigned");
      if (input.amount < problemStatement.basePrice) throw new AuctionError("bid_below_base_price");
      if (input.amount > lockedTeam.balance) throw new AuctionError("bid_exceeds_balance");

      const capacity = problemStatement.capacity ?? settings.defaultTeamsPerPs;
      if (!capacity || capacity < 1) throw new AuctionError("missing_capacity");

      const currentHolding = await Holding.findOne({ teamId: lockedTeam._id }).session(dbSession).lean<AuctionHolding>();
      if (currentHolding && String(currentHolding.problemStatementId) !== String(problemStatement._id)) {
        throw new AuctionError("already_holding_other");
      }
      if (currentHolding && input.amount < currentHolding.amount + settings.minIncrement) {
        throw new AuctionError("bid_increment_too_small");
      }

      let displacedTeamId: string | null = null;
      if (!currentHolding) {
        const [holdingCount, assignedCount] = await Promise.all([
          Holding.countDocuments({ problemStatementId: problemStatement._id }).session(dbSession),
          Team.countDocuments({ assignedPsId: problemStatement._id }).session(dbSession),
        ]);
        if (holdingCount + assignedCount >= capacity) {
          const lowestHolding = await Holding.findOne({ problemStatementId: problemStatement._id })
            .sort({ amount: 1, sequence: -1, _id: -1 })
            .session(dbSession)
            .lean<AuctionHolding>();
          if (!lowestHolding) throw new AuctionError("auction_integrity_error");
          // Equal bids never displace the earlier holding.
          if (input.amount <= lowestHolding.amount) {
            throw new AuctionError("bid_increment_too_small");
          }
          if (input.amount < lowestHolding.amount + settings.minIncrement) {
            throw new AuctionError("bid_increment_too_small");
          }
          const removed = await Holding.findOneAndDelete(
            { _id: lowestHolding._id, problemStatementId: problemStatement._id },
            { session: dbSession },
          ).lean<AuctionHolding>();
          if (!removed) throw new AuctionError("auction_integrity_error");
          displacedTeamId = String(removed.teamId);
        }
      }

      await Holding.findOneAndUpdate(
        { teamId: lockedTeam._id, problemStatementId: problemStatement._id },
        { $set: { amount: input.amount, sequence: problemStatement.bidSequence } },
        { upsert: true, new: true, setDefaultsOnInsert: true, session: dbSession },
      );
      const actorUserId = await getActorUserId(normalizeEmail(input.leaderEmail), dbSession);
      await Bid.create(
        [{ teamId: lockedTeam._id, problemStatementId: problemStatement._id, amount: input.amount, placedByUserId: actorUserId }],
        { session: dbSession },
      );
      await AuditLog.create(
        [
          {
            action: "auction.bid_placed",
            actorUserId,
            targetType: "ProblemStatement",
            targetId: problemStatement._id,
            newValue: { teamId: String(lockedTeam._id), amount: input.amount, displacedTeamId },
          },
        ],
        { session: dbSession },
      );
      result = { holdingAmount: input.amount, displacedTeamId };
    });
    if (!result) throw new AuctionError("auction_integrity_error");
    return result;
  } finally {
    await dbSession.endSession();
  }
}

export async function closeAuction(input: CloseAuctionInput): Promise<CloseAuctionResult> {
  if (!isObjectId(input.problemStatementId)) throw new AuctionError("invalid_input");

  await connectToDatabase();
  const dbSession = await mongoose.startSession();
  try {
    let result: CloseAuctionResult | null = null;
    await dbSession.withTransaction(async () => {
      await verifyAdmin(input.actorEmail, dbSession);
      const existing = await ProblemStatement.findById(input.problemStatementId)
        .session(dbSession)
        .lean<AuctionProblemStatement>();
      if (!existing) throw new AuctionError("problem_statement_not_found");
      if (existing.status === "closed") {
        result = { status: "already_closed", outcome: existing.auctionOutcome ?? null, winnerCount: 0 };
        return;
      }
      if (existing.status !== "live") throw new AuctionError("auction_not_live");

      const problemStatement = await lockLiveProblemStatement(input.problemStatementId, dbSession);
      const [actorUserId, holdings] = await Promise.all([
        getActorUserId(normalizeEmail(input.actorEmail), dbSession),
        Holding.find({ problemStatementId: problemStatement._id })
          .sort({ createdAt: 1, _id: 1 })
          .session(dbSession)
          .lean<AuctionHolding[]>(),
      ]);

      for (const holding of holdings) {
        const assignedTeam = await Team.findOneAndUpdate(
          { _id: holding.teamId, assignedPsId: null, balance: { $gte: holding.amount } },
          {
            $set: { assignedPsId: problemStatement._id, assignmentType: "won" },
            $inc: { balance: -holding.amount },
          },
          { new: true, session: dbSession },
        ).lean<{ _id: mongoose.Types.ObjectId; balance: number }>();
        if (!assignedTeam) throw new AuctionError("auction_integrity_error");
        await AuditLog.create(
          [
            {
              action: "auction.ps_won",
              actorUserId,
              targetType: "Team",
              targetId: holding.teamId,
              previousValue: { assignedPsId: null, balance: assignedTeam.balance + holding.amount },
              newValue: { assignedPsId: String(problemStatement._id), assignmentType: "won", balance: assignedTeam.balance, paid: holding.amount },
            },
          ],
          { session: dbSession },
        );
      }

      await Holding.deleteMany({ problemStatementId: problemStatement._id }).session(dbSession);
      const outcome = holdings.length > 0 ? "sold" : "unsold";
      await ProblemStatement.updateOne(
        { _id: problemStatement._id, status: "live" },
        { $set: { status: "closed", auctionOutcome: outcome } },
        { session: dbSession },
      );
      await AuditLog.create(
        [
          {
            action: "auction.closed",
            actorUserId,
            targetType: "ProblemStatement",
            targetId: problemStatement._id,
            newValue: { status: "closed", outcome, winnerCount: holdings.length },
          },
        ],
        { session: dbSession },
      );
      result = { status: "closed", outcome, winnerCount: holdings.length };
    });
    if (!result) throw new AuctionError("auction_integrity_error");
    return result;
  } finally {
    await dbSession.endSession();
  }
}
