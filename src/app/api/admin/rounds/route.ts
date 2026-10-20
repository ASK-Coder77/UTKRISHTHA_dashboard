import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AdminAuthError, checkOrigin, requireAdmin } from "@/lib/admin-auth";
import { connectToDatabase } from "@/lib/db";
import { checkAdminMutationRateLimit } from "@/lib/rate-limit";
import { normalizeEmail } from "@/lib/roles";
import { AuditLog } from "@/models/AuditLog";
import { JudgeAllowlist } from "@/models/JudgeAllowlist";
import { Round } from "@/models/Round";
import { Score } from "@/models/Score";
import { Setting } from "@/models/Setting";

const email = z.string().trim().email().max(254).transform(normalizeEmail);
const criterion = z.object({ name: z.string().trim().min(1).max(120), maxPoints: z.number().int().min(0).max(1_000_000) }).strict();
const roundValues = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2_000),
  maxPointsPerJudge: z.number().int().min(1).max(1_000_000),
  aggregation: z.enum(["average", "sum"]),
  weight: z.number().finite().min(0).max(1_000_000),
  assignedJudgeEmails: z.array(email).max(100).refine((items) => new Set(items).size === items.length, "Duplicate judge"),
  criteria: z.array(criterion).min(1).max(20).refine((items) => new Set(items.map((item) => item.name.toLowerCase())).size === items.length, "Duplicate criterion"),
}).strict().superRefine((value, context) => {
  if (value.criteria.reduce((sum, item) => sum + item.maxPoints, 0) !== value.maxPointsPerJudge) {
    context.addIssue({ code: "custom", message: "Criterion maximums must sum to the round maximum." });
  }
});
const createSchema = roundValues.extend({ order: z.number().int().min(1).max(10_000) }).strict();
const updateSchema = roundValues.extend({ id: z.string().regex(/^[0-9a-f]{24}$/i), order: z.number().int().min(1).max(10_000) }).strict();
const deleteSchema = z.object({ id: z.string().regex(/^[0-9a-f]{24}$/i) }).strict();

function identifier(request: Request, actorEmail: string) {
  return `${actorEmail}:${request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"}`;
}
function serialize(round: { _id: mongoose.Types.ObjectId; name: string; order: number; description: string; maxPointsPerJudge: number; aggregation: "average" | "sum"; weight: number; assignedJudgeEmails: string[]; criteria: Array<{ name: string; maxPoints: number }>; status: "upcoming" | "open" | "closed" }) {
  return { id: String(round._id), name: round.name, order: round.order, description: round.description, maxPointsPerJudge: round.maxPointsPerJudge, aggregation: round.aggregation, weight: round.weight, assignedJudgeEmails: round.assignedJudgeEmails, criteria: round.criteria, status: round.status };
}

async function validateJudges(judges: string[], roundId?: string) {
  const [allowlisted, setting] = await Promise.all([
    JudgeAllowlist.find({ email: { $in: judges } }).select({ email: 1 }).lean<Array<{ email: string }>>(),
    Setting.findOne({ singletonKey: "global" }).select({ allowSameJudgeAcrossRounds: 1 }).lean<{ allowSameJudgeAcrossRounds: boolean } | null>(),
  ]);
  if (allowlisted.length !== judges.length) throw new RoundInputError("Every assigned judge must be on the judge allowlist.");
  if (!setting?.allowSameJudgeAcrossRounds && judges.length > 0) {
    const conflict = await Round.exists({ _id: roundId ? { $ne: roundId } : { $exists: true }, assignedJudgeEmails: { $in: judges } });
    if (conflict) throw new RoundInputError("A judge can only be assigned to one round under the current settings.");
  }
}

export async function GET() {
  try {
    await connectToDatabase();
    const actor = await requireAdmin("admin");
    let rounds = await Round.find({}).sort({ order: 1 }).lean();
    if (rounds.length === 0) {
      try {
        await Round.create([{
          name: "Showdown", order: 1, description: "Day 2 prototype and showdown judging", maxPointsPerJudge: 100, aggregation: "average", weight: 1, assignedJudgeEmails: [], status: "upcoming",
          criteria: [
            { name: "Innovation and originality", maxPoints: 20 },
            { name: "Technical implementation", maxPoints: 25 },
            { name: "Functionality and execution", maxPoints: 20 },
            { name: "Problem relevance and impact", maxPoints: 20 },
            { name: "Presentation and technical defense", maxPoints: 15 },
          ],
        }]);
      } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
      }
      rounds = await Round.find({}).sort({ order: 1 }).lean();
    }
    if (actor.role === "super_admin") {
      await migrateLegacyDefaultRoundLabels(actor.userId);
      rounds = await Round.find({}).sort({ order: 1 }).lean();
    }
    return NextResponse.json({ rounds: rounds.map((round) => serialize(round as unknown as Parameters<typeof serialize>[0])) });
  } catch (error) {
    if (error instanceof AdminAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Failed to load rounds", error);
    return NextResponse.json({ error: "Unable to load rounds." }, { status: 500 });
  }
}

async function migrateLegacyDefaultRoundLabels(actorUserId: mongoose.Types.ObjectId | null) {
  const legacyLabels = [
    { order: 1, previousName: "Round 1: Features", name: "Day 2: Features" },
    { order: 2, previousName: "Round 2: Final project", name: "Day 3: Final project" },
  ] as const;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      for (const label of legacyLabels) {
        const round = await Round.findOne({ order: label.order, name: label.previousName }).session(session);
        if (!round || await Score.exists({ roundId: round._id }).session(session)) continue;
        await Round.updateOne({ _id: round._id, name: label.previousName }, { $set: { name: label.name } }, { session });
        await AuditLog.create([{
          action: "round.default_label_migrated",
          actorUserId,
          targetType: "Round",
          targetId: round._id,
          previousValue: { name: label.previousName },
          newValue: { name: label.name },
        }], { session });
      }
    });
  } finally {
    await session.endSession();
  }
}

export async function POST(request: Request) {
  return mutate(request, "create");
}
export async function PATCH(request: Request) {
  return mutate(request, "update");
}
export async function DELETE(request: Request) {
  if (!checkOrigin(request)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  try {
    await connectToDatabase(); const actor = await requireAdmin("super_admin");
    const limited = await checkAdminMutationRateLimit(identifier(request, actor.email));
    if (!limited.allowed) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    const parsed = deleteSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Invalid round request." }, { status: 400 });
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const round = await Round.findById(parsed.data.id).session(session);
        if (!round) throw new NotFoundError();
        if (await Score.exists({ roundId: round._id }).session(session)) throw new RoundInputError("Rounds with submitted scores cannot be removed.");
        await round.deleteOne({ session });
        await AuditLog.create([{ action: "round.deleted", actorUserId: actor.userId, targetType: "Round", targetId: round._id, previousValue: { name: round.name, order: round.order }, newValue: null }], { session });
      });
    } finally { await session.endSession(); }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return mutationError(error, "Unable to remove round.");
  }
}

async function mutate(request: Request, action: "create" | "update") {
  if (!checkOrigin(request)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  try {
    await connectToDatabase(); const actor = await requireAdmin("super_admin");
    const limited = await checkAdminMutationRateLimit(identifier(request, actor.email));
    if (!limited.allowed) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    const parsed = (action === "create" ? createSchema : updateSchema).safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Invalid round configuration." }, { status: 400 });
    const data = parsed.data;
    const updateId = action === "update" ? (data as z.infer<typeof updateSchema>).id : undefined;
    await validateJudges(data.assignedJudgeEmails, updateId);
    const session = await mongoose.startSession(); let result: Parameters<typeof serialize>[0] | null = null;
    try {
      await session.withTransaction(async () => {
        if (action === "create") {
          const created = await Round.create([{ ...data, status: "upcoming" }], { session }); result = created[0].toObject() as Parameters<typeof serialize>[0];
          await AuditLog.create([{ action: "round.created", actorUserId: actor.userId, targetType: "Round", targetId: created[0]._id, previousValue: null, newValue: { name: data.name, order: data.order } }], { session });
        } else {
          const existing = await Round.findById(updateId).session(session);
          if (!existing) throw new NotFoundError();
          if (await Score.exists({ roundId: existing._id }).session(session)) {
            const criteriaChanged = JSON.stringify((existing.criteria as Array<{ name: string; maxPoints: number }>).map((item) => ({ name: item.name, maxPoints: item.maxPoints }))) !== JSON.stringify(data.criteria);
            if (criteriaChanged) throw new RoundInputError("Criteria cannot be changed after scoring has started.");
          }
          const maxScore = await Score.findOne({ roundId: existing._id }).sort({ points: -1 }).select({ points: 1 }).session(session).lean<{ points: number } | null>();
          if (maxScore && data.maxPointsPerJudge < maxScore.points) throw new RoundInputError("Maximum points cannot be lower than an existing score.");
          const before = { name: existing.name, order: existing.order, maxPointsPerJudge: existing.maxPointsPerJudge, aggregation: existing.aggregation, weight: existing.weight, assignedJudgeEmails: existing.assignedJudgeEmails, criteria: existing.criteria };
          Object.assign(existing, data); await existing.save({ session }); result = existing.toObject() as Parameters<typeof serialize>[0];
          await AuditLog.create([{ action: "round.updated", actorUserId: actor.userId, targetType: "Round", targetId: existing._id, previousValue: before, newValue: { name: existing.name, order: existing.order, maxPointsPerJudge: existing.maxPointsPerJudge, aggregation: existing.aggregation, weight: existing.weight, assignedJudgeEmails: existing.assignedJudgeEmails, criteria: existing.criteria } }], { session });
        }
      });
    } finally { await session.endSession(); }
    return NextResponse.json({ round: serialize(result!) }, { status: action === "create" ? 201 : 200 });
  } catch (error) { return mutationError(error, "Unable to save round."); }
}
function mutationError(error: unknown, fallback: string) {
  if (error instanceof AdminAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof RoundInputError) return NextResponse.json({ error: error.message }, { status: 400 });
  if (error instanceof NotFoundError) return NextResponse.json({ error: "Round not found." }, { status: 404 });
  if (error instanceof SyntaxError) return NextResponse.json({ error: "Invalid round request." }, { status: 400 });
  if ((error as { code?: number }).code === 11000) return NextResponse.json({ error: "Round order must be unique." }, { status: 409 });
  console.error("Round mutation failed", error); return NextResponse.json({ error: fallback }, { status: 500 });
}
class RoundInputError extends Error {}
class NotFoundError extends Error {}
