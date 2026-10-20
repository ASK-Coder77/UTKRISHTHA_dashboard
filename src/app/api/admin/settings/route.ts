import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { checkOrigin } from "@/lib/admin-auth";
import { connectToDatabase } from "@/lib/db";
import { getRoleForEmail, normalizeEmail } from "@/lib/roles";
import { getSettings, type SettingsRecord } from "@/lib/settings";
import { AuditLog } from "@/models/AuditLog";
import { Holding } from "@/models/Holding";
import { ProblemStatement } from "@/models/ProblemStatement";
import { Setting } from "@/models/Setting";
import { Team } from "@/models/Team";
import { TeamMember } from "@/models/TeamMember";
import { User } from "@/models/User";
import mongoose from "mongoose";
import { isRollNumberValidForYear } from "@/lib/team-validation";

const integer = z.number().int().finite();
const settingsUpdateSchema = z
  .object({
    startingPoints: integer.min(0).max(1_000_000).optional(),
    eventYear: integer.min(2000).max(2100).optional(),
    defaultTeamsPerPs: integer.min(1).max(10_000).nullable().optional(),
    minIncrement: integer.min(1).max(1_000_000).optional(),
    minTeamSize: integer.min(1).max(100).optional(),
    maxTeamSize: integer.min(1).max(100).optional(),
    registrationOpen: z.boolean().optional(),
    powerupMultiplier: z.number().finite().min(0).max(1_000_000).optional(),
    powerupForAllocatedTeams: z.boolean().optional(),
    allowNonCollegeJudges: z.boolean().optional(),
    allowSameJudgeAcrossRounds: z.boolean().optional(),
    resultsPublished: z.boolean().optional(),
    submissionsOpen: z.boolean().optional(),
    redemptionOpen: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "At least one setting is required");

type SettingsUpdate = z.infer<typeof settingsUpdateSchema>;
type SettingsField = keyof SettingsUpdate;

async function getRequestActor() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return null;

  const normalizedEmail = normalizeEmail(email);
  const role = await getRoleForEmail(normalizedEmail);
  const user = (await User.findOne({ email: normalizedEmail }).select({ _id: 1 }).lean()) as unknown as { _id: unknown } | null;
  return { role, userId: user?._id ?? null };
}

function serializeSettings(settings: SettingsRecord) {
  return {
    startingPoints: settings.startingPoints,
    eventYear: settings.eventYear,
    defaultTeamsPerPs: settings.defaultTeamsPerPs,
    minIncrement: settings.minIncrement,
    minTeamSize: settings.minTeamSize,
    maxTeamSize: settings.maxTeamSize,
    registrationOpen: settings.registrationOpen,
    powerupMultiplier: settings.powerupMultiplier,
    powerupForAllocatedTeams: settings.powerupForAllocatedTeams,
    allowNonCollegeJudges: settings.allowNonCollegeJudges,
    allowSameJudgeAcrossRounds: settings.allowSameJudgeAcrossRounds,
    resultsPublished: settings.resultsPublished,
    submissionsOpen: settings.submissionsOpen,
    redemptionOpen: settings.redemptionOpen,
  };
}

export async function GET() {
  try {
    await connectToDatabase();
    const actor = await getRequestActor();
    if (!actor || actor.role !== "super_admin") {
      return NextResponse.json({ error: "You do not have permission to view settings." }, { status: 403 });
    }

    return NextResponse.json({ settings: serializeSettings(await getSettings()) });
  } catch (error) {
    console.error("Unable to read settings", error);
    return NextResponse.json({ error: "Unable to load settings." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  if (!checkOrigin(request)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  try {
    await connectToDatabase();
    const actor = await getRequestActor();
    if (!actor || (actor.role !== "super_admin" && actor.role !== "admin")) {
      return NextResponse.json({ error: "You do not have permission to change settings." }, { status: 403 });
    }

    const body: unknown = await request.json();
    if (
      actor.role === "admin" &&
      (typeof body !== "object" ||
        body === null ||
        Array.isArray(body) ||
        Object.keys(body).length !== 1 ||
        !["registrationOpen", "submissionsOpen", "redemptionOpen"].some((field) => Object.prototype.hasOwnProperty.call(body, field)))
    ) {
      return NextResponse.json({ error: "Only super admins can change these settings." }, { status: 403 });
    }

    const parsed = settingsUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid settings update." }, { status: 400 });
    }

    if (actor.role === "admin" && (Object.keys(parsed.data).length !== 1 || !["registrationOpen", "submissionsOpen", "redemptionOpen"].some((field) => field in parsed.data))) {
      return NextResponse.json({ error: "Only super admins can change these settings." }, { status: 403 });
    }

    const current = await getSettings();
    if (!current) throw new Error("Settings could not be initialized");
    const update = parsed.data;
    const nextMinTeamSize = update.minTeamSize ?? current.minTeamSize;
    const nextMaxTeamSize = update.maxTeamSize ?? current.maxTeamSize;
    if (nextMinTeamSize > nextMaxTeamSize) {
      return NextResponse.json({ error: "Minimum team size cannot exceed maximum team size." }, { status: 400 });
    }

    try {
      await validateDefaultCapacityChange(update, current.defaultTeamsPerPs);
      await validateEventYearChange(update, current.eventYear);
    } catch (error) {
      if (error instanceof CapacityGuardrailError) {
        return NextResponse.json(
          { error: "Default capacity cannot be lower than teams already holding or assigned to an affected problem statement." },
          { status: 400 },
        );
      }
      if (error instanceof EventYearGuardrailError) {
        return NextResponse.json({ error: "Event year cannot change because it would invalidate an existing member roll number." }, { status: 400 });
      }
      throw error;
    }

    const changedEntries = (Object.entries(update) as Array<[SettingsField, SettingsUpdate[SettingsField]]>).filter(
      ([key, value]) => current[key] !== value,
    );
    if (changedEntries.length === 0) {
      return NextResponse.json({ settings: serializeSettings(current) });
    }

    const session = await mongoose.startSession();
    try {
      let updatedSettings: SettingsRecord | null = null;
      await session.withTransaction(async () => {
        const updated = (await Setting.findOneAndUpdate(
          { singletonKey: current.singletonKey },
          { $set: update },
          { new: true, runValidators: true, session },
        ).lean()) as unknown as SettingsRecord | null;
        if (!updated) throw new Error("Settings could not be updated");
        updatedSettings = updated;

        await AuditLog.insertMany(
          changedEntries.map(([key, value]) => ({
            action: "setting.changed",
            actorUserId: actor.userId,
            targetType: "Setting",
            targetId: updated._id,
            previousValue: { [key]: current[key] },
            newValue: { [key]: value },
          })),
          { session },
        );
      });
      if (!updatedSettings) throw new Error("Settings could not be updated");
      return NextResponse.json({ settings: serializeSettings(updatedSettings) });
    } finally {
      await session.endSession();
    }
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid settings update." }, { status: 400 });
    }
    console.error("Unable to update settings", error);
    return NextResponse.json({ error: "Unable to update settings." }, { status: 500 });
  }
}

async function validateDefaultCapacityChange(update: SettingsUpdate, currentDefault: number | null) {
  if (update.defaultTeamsPerPs === undefined || update.defaultTeamsPerPs === currentDefault) return;

  const affectedProblemStatements = await ProblemStatement.find({ capacity: null }).select({ _id: 1 }).lean();
  if (affectedProblemStatements.length === 0) return;
  if (update.defaultTeamsPerPs === null) {
    return;
  }

  const ids = affectedProblemStatements.map((problemStatement) => problemStatement._id);
  const [holdings, assignments] = await Promise.all([
    Holding.aggregate<{ _id: unknown; count: number }>([
      { $match: { problemStatementId: { $in: ids } } },
      { $group: { _id: "$problemStatementId", count: { $sum: 1 } } },
    ]),
    Team.aggregate<{ _id: unknown; count: number }>([
      { $match: { assignedPsId: { $in: ids } } },
      { $group: { _id: "$assignedPsId", count: { $sum: 1 } } },
    ]),
  ]);
  const usedSeats = new Map<string, number>();
  for (const item of [...holdings, ...assignments]) {
    const key = String(item._id);
    usedSeats.set(key, (usedSeats.get(key) ?? 0) + item.count);
  }
  if ([...usedSeats.values()].some((count) => count > update.defaultTeamsPerPs!)) {
    throw new CapacityGuardrailError();
  }
}

class CapacityGuardrailError extends Error {}

async function validateEventYearChange(update: SettingsUpdate, currentEventYear: number) {
  const eventYear = update.eventYear;
  if (eventYear === undefined || eventYear === currentEventYear) return;
  const members = await TeamMember.find({}).select({ normalizedRollNumber: 1, year: 1 }).lean<Array<{ normalizedRollNumber: string; year: "UG1" | "UG2" | "UG3" | "UG4" }>>();
  if (members.some((member) => !isRollNumberValidForYear(member.normalizedRollNumber, member.year, eventYear))) {
    throw new EventYearGuardrailError();
  }
}

class EventYearGuardrailError extends Error {}
