import { randomInt } from "node:crypto";
import mongoose from "mongoose";
import { isValidObjectId } from "@/lib/admin-auth";
import { connectToDatabase } from "@/lib/db";
import { getSuperAdminEmails, normalizeEmail } from "@/lib/roles";
import { AdminAllowlist } from "@/models/AdminAllowlist";
import { AuditLog } from "@/models/AuditLog";
import { Holding } from "@/models/Holding";
import { ProblemStatement } from "@/models/ProblemStatement";
import { Round } from "@/models/Round";
import { Setting } from "@/models/Setting";
import { Team } from "@/models/Team";
import { User } from "@/models/User";

type ManualAllocationInput = {
  teamId: string;
  problemStatementId: string;
  actorEmail: string;
  exceedCapacityConfirmed?: boolean;
};

type RandomAllocationInput = {
  actorEmail: string;
};

export type ManualAllocationResult = {
  teamId: string;
  problemStatementId: string;
  exceededCapacity: boolean;
};

export type RandomAllocationResult = {
  allocatedTeamIds: string[];
  unassignedTeamIds: string[];
  trackSummary: Record<"web_dev" | "ai_ml", { availableSeats: number; unassignedTeams: number; shortfall: number }>;
};

type AllocationTeam = {
  _id: mongoose.Types.ObjectId;
  assignedPsId: mongoose.Types.ObjectId | null;
  pointsGiven: boolean;
  track: "web_dev" | "ai_ml";
};

type AllocationProblemStatement = {
  _id: mongoose.Types.ObjectId;
  capacity: number | null;
  status: "upcoming" | "live" | "closed";
  track: "web_dev" | "ai_ml";
  revealed: boolean;
};

type AllocationSettings = { _id: mongoose.Types.ObjectId; defaultTeamsPerPs: number | null };

export class AllocationError extends Error {
  public readonly code:
    | "invalid_input"
    | "not_admin"
    | "not_super_admin"
    | "team_not_found"
    | "team_not_participating"
    | "team_already_assigned"
    | "team_holding_spot"
    | "problem_statement_not_found"
    | "auction_still_live"
    | "missing_capacity"
    | "capacity_reached"
    | "capacity_confirmation_required"
    | "round_already_open"
    | "super_admin_confirmation_required"
    | "allocation_integrity_error"
    | "track_mismatch";

  constructor(code: AllocationError["code"]) {
    super(code);
    this.name = "AllocationError";
    this.code = code;
  }
}

function isObjectId(value: string) {
  return isValidObjectId(value);
}

function shuffled<T>(items: T[]) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const replacement = randomInt(index + 1);
    [result[index], result[replacement]] = [result[replacement], result[index]];
  }
  return result;
}

function effectiveCapacity(problemStatement: AllocationProblemStatement, settings: AllocationSettings) {
  return problemStatement.capacity ?? settings.defaultTeamsPerPs;
}

async function verifyAdmin(actorEmail: string, session: mongoose.ClientSession) {
  const normalizedEmail = normalizeEmail(actorEmail);
  if (getSuperAdminEmails().includes(normalizedEmail)) return;
  const isAdmin = await AdminAllowlist.exists({ email: normalizedEmail }).session(session);
  if (!isAdmin) throw new AllocationError("not_admin");
}

async function getActorUserId(actorEmail: string, session: mongoose.ClientSession) {
  const user = await User.findOne({ email: normalizeEmail(actorEmail) }).select({ _id: 1 }).session(session).lean<{ _id: mongoose.Types.ObjectId }>();
  if (!user) throw new AllocationError("allocation_integrity_error");
  return user._id;
}

/** Locks every non-live PS so allocation transactions serialize with capacity changes. */
async function lockAllocationProblemStatements(session: mongoose.ClientSession) {
  const liveProblemStatement = await ProblemStatement.exists({ status: "live" }).session(session);
  if (liveProblemStatement) throw new AllocationError("auction_still_live");

  const problemStatements = await ProblemStatement.find({ status: { $ne: "live" }, revealed: true })
    .sort({ _id: 1 })
    .session(session)
    .lean<AllocationProblemStatement[]>();
  for (const problemStatement of problemStatements) {
    const locked = await ProblemStatement.findOneAndUpdate(
      { _id: problemStatement._id, status: { $ne: "live" } },
      { $inc: { version: 1 } },
      { new: true, session },
    ).lean<AllocationProblemStatement>();
    if (!locked) throw new AllocationError("auction_still_live");
  }
  return problemStatements;
}

async function startAllocation(session: mongoose.ClientSession) {
  const settings = await Setting.findOne(
    { singletonKey: "global" },
  ).session(session).lean<AllocationSettings>();
  if (!settings) throw new AllocationError("allocation_integrity_error");
  return settings;
}

async function assignTeam({
  teamId,
  problemStatementId,
  actorUserId,
  session,
  exceededCapacity,
}: {
  teamId: mongoose.Types.ObjectId;
  problemStatementId: mongoose.Types.ObjectId;
  actorUserId: mongoose.Types.ObjectId;
  session: mongoose.ClientSession;
  exceededCapacity: boolean;
}) {
  const assignedTeam = await Team.findOneAndUpdate(
    { _id: teamId, pointsGiven: true, assignedPsId: null },
    { $set: { assignedPsId: problemStatementId, assignmentType: "allocated" } },
    { new: true, session },
  ).lean<AllocationTeam>();
  if (!assignedTeam) throw new AllocationError("team_already_assigned");
  await AuditLog.create(
    [{
      action: "allocation.assigned",
      actorUserId,
      targetType: "Team",
      targetId: teamId,
      previousValue: { assignedPsId: null, assignmentType: null },
      newValue: { assignedPsId: String(problemStatementId), assignmentType: "allocated", exceededCapacity },
    }],
    { session },
  );
}

export async function manuallyAllocate(input: ManualAllocationInput): Promise<ManualAllocationResult> {
  if (!isObjectId(input.teamId) || !isObjectId(input.problemStatementId)) {
    throw new AllocationError("invalid_input");
  }

  await connectToDatabase();
  const dbSession = await mongoose.startSession();
  try {
    let result: ManualAllocationResult | null = null;
    await dbSession.withTransaction(async () => {
      await verifyAdmin(input.actorEmail, dbSession);
      const actorUserId = await getActorUserId(input.actorEmail, dbSession);
      const settings = await startAllocation(dbSession);
      const problemStatements = await lockAllocationProblemStatements(dbSession);
      const team = await Team.findById(input.teamId).session(dbSession).lean<AllocationTeam>();
      if (!team) throw new AllocationError("team_not_found");
      if (!team.pointsGiven) throw new AllocationError("team_not_participating");
      if (team.assignedPsId) throw new AllocationError("team_already_assigned");
      if (await Holding.exists({ teamId: team._id }).session(dbSession)) throw new AllocationError("team_holding_spot");

      const problemStatement = problemStatements.find((entry) => String(entry._id) === input.problemStatementId);
      if (!problemStatement) {
        const exists = await ProblemStatement.exists({ _id: input.problemStatementId }).session(dbSession);
        if (!exists) throw new AllocationError("problem_statement_not_found");
        throw new AllocationError("auction_still_live");
      }
      if (team.track !== problemStatement.track) throw new AllocationError("track_mismatch");
      const capacity = effectiveCapacity(problemStatement, settings);
      if (!capacity || capacity < 1) throw new AllocationError("missing_capacity");
      const assignedCount = await Team.countDocuments({ assignedPsId: problemStatement._id }).session(dbSession);
      const exceededCapacity = assignedCount >= capacity;
      if (exceededCapacity && !input.exceedCapacityConfirmed) {
        throw new AllocationError("capacity_confirmation_required");
      }

      await assignTeam({ teamId: team._id, problemStatementId: problemStatement._id, actorUserId, session: dbSession, exceededCapacity });
      result = { teamId: String(team._id), problemStatementId: String(problemStatement._id), exceededCapacity };
    });
    if (!result) throw new AllocationError("allocation_integrity_error");
    return result;
  } finally {
    await dbSession.endSession();
  }
}

export async function randomlyAllocate(input: RandomAllocationInput): Promise<RandomAllocationResult> {
  await connectToDatabase();
  const dbSession = await mongoose.startSession();
  try {
    let result: RandomAllocationResult | null = null;
    await dbSession.withTransaction(async () => {
      await verifyAdmin(input.actorEmail, dbSession);
      const actorUserId = await getActorUserId(input.actorEmail, dbSession);
      const settings = await startAllocation(dbSession);
      const problemStatements = await lockAllocationProblemStatements(dbSession);
      const teams = await Team.find({ pointsGiven: true, assignedPsId: null }).sort({ _id: 1 }).session(dbSession).lean<AllocationTeam[]>();

      const assignedCounts = new Map<string, number>();
      const assigned = await Team.aggregate<{ _id: mongoose.Types.ObjectId; count: number }>([
        { $match: { assignedPsId: { $ne: null } } },
        { $group: { _id: "$assignedPsId", count: { $sum: 1 } } },
      ]).session(dbSession);
      for (const entry of assigned) assignedCounts.set(String(entry._id), entry.count);

      const candidates = problemStatements
        .map((problemStatement) => ({ problemStatement, capacity: effectiveCapacity(problemStatement, settings) }))
        .filter((entry): entry is { problemStatement: AllocationProblemStatement; capacity: number } => Boolean(entry.capacity && entry.capacity > 0));
      const allocatedTeamIds: string[] = [];
      const unassignedTeamIds: string[] = [];
      const availableSeats = { web_dev: 0, ai_ml: 0 };
      for (const { problemStatement, capacity } of candidates) {
        availableSeats[problemStatement.track] += Math.max(0, capacity - (assignedCounts.get(String(problemStatement._id)) ?? 0));
      }

      for (const team of shuffled(teams)) {
        const openProblemStatements = candidates.filter(({ problemStatement, capacity }) =>
          problemStatement.track === team.track && (assignedCounts.get(String(problemStatement._id)) ?? 0) < capacity,
        );
        if (openProblemStatements.length === 0) {
          unassignedTeamIds.push(String(team._id));
          continue;
        }
        const selected = openProblemStatements[randomInt(openProblemStatements.length)].problemStatement;
        if (await Holding.exists({ teamId: team._id }).session(dbSession)) throw new AllocationError("team_holding_spot");
        await assignTeam({
          teamId: team._id,
          problemStatementId: selected._id,
          actorUserId,
          session: dbSession,
          exceededCapacity: false,
        });
        assignedCounts.set(String(selected._id), (assignedCounts.get(String(selected._id)) ?? 0) + 1);
        allocatedTeamIds.push(String(team._id));
      }
      const unassignedByTrack = { web_dev: 0, ai_ml: 0 };
      for (const teamId of unassignedTeamIds) {
        const team = teams.find((entry) => String(entry._id) === teamId);
        if (team) unassignedByTrack[team.track] += 1;
      }
      result = {
        allocatedTeamIds,
        unassignedTeamIds,
        trackSummary: {
          web_dev: { availableSeats: availableSeats.web_dev, unassignedTeams: unassignedByTrack.web_dev, shortfall: Math.max(0, unassignedByTrack.web_dev) },
          ai_ml: { availableSeats: availableSeats.ai_ml, unassignedTeams: unassignedByTrack.ai_ml, shortfall: Math.max(0, unassignedByTrack.ai_ml) },
        },
      };
    });
    if (!result) throw new AllocationError("allocation_integrity_error");
    return result;
  } finally {
    await dbSession.endSession();
  }
}

// ---------------------------------------------------------------------------
// Reassign: change a team's already-assigned PS (spec §6)
// ---------------------------------------------------------------------------

type ReassignInput = {
  teamId: string;
  newPsId: string;
  actorEmail: string;
  /** Required when the team's assignmentType is "won". */
  superAdminConfirmed?: boolean;
  exceedCapacityConfirmed?: boolean;
};

export type ReassignResult = {
  teamId: string;
  newPsId: string;
  previousPsId: string;
  exceededCapacity: boolean;
};

type ReassignTeam = {
  _id: mongoose.Types.ObjectId;
  pointsGiven: boolean;
  track: "web_dev" | "ai_ml";
  assignedPsId: mongoose.Types.ObjectId | null;
  assignmentType: "won" | "allocated" | null;
};

export async function reassignPs(input: ReassignInput): Promise<ReassignResult> {
  if (!isObjectId(input.teamId) || !isObjectId(input.newPsId)) {
    throw new AllocationError("invalid_input");
  }

  await connectToDatabase();
  const dbSession = await mongoose.startSession();
  try {
    let result: ReassignResult | null = null;
    await dbSession.withTransaction(async () => {
      const normalizedEmail = normalizeEmail(input.actorEmail);
      const isSuperAdmin = getSuperAdminEmails().includes(normalizedEmail);
      if (!isSuperAdmin) {
        const isAdmin = await AdminAllowlist.exists({ email: normalizedEmail }).session(dbSession);
        if (!isAdmin) throw new AllocationError("not_admin");
      }

      const actorUserId = await getActorUserId(input.actorEmail, dbSession);
      const team = await Team.findById(input.teamId).session(dbSession).lean<ReassignTeam>();
      const settings = await Setting.findOne({ singletonKey: "global" }).session(dbSession).lean<AllocationSettings>();
      if (!settings) throw new AllocationError("allocation_integrity_error");
      if (!team) throw new AllocationError("team_not_found");
      if (!team.pointsGiven) throw new AllocationError("team_not_participating");
      if (!team.assignedPsId) throw new AllocationError("team_not_found"); // not yet assigned

      const previousPsId = String(team.assignedPsId);

      // Won-team reassignment requires super_admin + explicit confirmation
      if (team.assignmentType === "won") {
        if (!isSuperAdmin) throw new AllocationError("not_super_admin");
        if (!input.superAdminConfirmed) throw new AllocationError("super_admin_confirmation_required");
      }

      // Block if any Round is open (for won teams) or Round 1 is open (for allocated teams)
      const openRound = await Round.findOne({ status: "open" }).sort({ order: 1 }).session(dbSession).lean<{ order: number }>();
      if (openRound) {
        if (team.assignmentType === "won") throw new AllocationError("round_already_open");
        // For allocated teams: blocked once Round 1 (lowest order) is open
        if (openRound.order <= 1) throw new AllocationError("round_already_open");
      }

      // Lock and validate the new PS
      const newPs = await ProblemStatement.findOneAndUpdate(
        { _id: input.newPsId, status: { $ne: "live" }, revealed: true },
        { $inc: { version: 1 } },
        { new: true, session: dbSession },
      ).lean<AllocationProblemStatement>();
      if (!newPs) {
        const exists = await ProblemStatement.exists({ _id: input.newPsId }).session(dbSession);
        if (!exists) throw new AllocationError("problem_statement_not_found");
        throw new AllocationError("auction_still_live");
      }
      if (newPs.track !== team.track) throw new AllocationError("track_mismatch");

      const capacity = effectiveCapacity(newPs, settings);
      if (!capacity || capacity < 1) throw new AllocationError("missing_capacity");
      const assignedCount = await Team.countDocuments({
        assignedPsId: newPs._id,
        _id: { $ne: team._id },
      }).session(dbSession);
      const exceededCapacity = assignedCount >= capacity;
      if (exceededCapacity && !input.exceedCapacityConfirmed) {
        throw new AllocationError("capacity_confirmation_required");
      }

      // Conditional atomic update: only succeeds if team still has the old PS
      const updated = await Team.findOneAndUpdate(
        { _id: team._id, assignedPsId: team.assignedPsId },
        { $set: { assignedPsId: newPs._id } },
        { new: true, session: dbSession },
      ).lean<ReassignTeam>();
      if (!updated) throw new AllocationError("allocation_integrity_error");

      await AuditLog.create(
        [{
          action: "allocation.reassigned",
          actorUserId,
          targetType: "Team",
          targetId: team._id,
          previousValue: { assignedPsId: previousPsId, assignmentType: team.assignmentType },
          newValue: {
            assignedPsId: String(newPs._id),
            assignmentType: team.assignmentType,
            exceededCapacity,
            superAdminOverride: team.assignmentType === "won",
          },
        }],
        { session: dbSession },
      );

      result = { teamId: String(team._id), newPsId: String(newPs._id), previousPsId, exceededCapacity };
    });
    if (!result) throw new AllocationError("allocation_integrity_error");
    return result;
  } finally {
    await dbSession.endSession();
  }
}
