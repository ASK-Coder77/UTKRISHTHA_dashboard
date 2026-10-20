import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { checkOrigin } from "@/lib/admin-auth";
import { connectToDatabase } from "@/lib/db";
import { checkTeamRegistrationRateLimit } from "@/lib/rate-limit";
import { getRoleForEmail, getSuperAdminEmails, isAllowedDomain, normalizeEmail } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { isRollNumberValidForYear, isTrackYearCombinationValid, normalizeRollNumber, rollNumberPattern } from "@/lib/team-validation";
import { AdminAllowlist } from "@/models/AdminAllowlist";
import { AuditLog } from "@/models/AuditLog";
import { Bid } from "@/models/Bid";
import { JudgeAllowlist } from "@/models/JudgeAllowlist";
import { Team } from "@/models/Team";
import { TeamMember } from "@/models/TeamMember";
import { User } from "@/models/User";
import { ProblemStatement } from "@/models/ProblemStatement";
import { Holding } from "@/models/Holding";

export async function GET() {
  try {
    await connectToDatabase();
    const session = await auth();
    if (!session?.user?.email) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    const email = normalizeEmail(session.user.email);
    const role = await getRoleForEmail(email);
    if (role !== "team_leader" && role !== "student") return NextResponse.json({ team: null });
    const membership = role === "team_leader" ? null : await TeamMember.findOne({ email }).select({ teamId: 1 }).lean<{ teamId: unknown }>();
    const team = await Team.findOne(role === "team_leader" ? { leaderEmail: email } : { _id: membership?.teamId }).lean<{
      _id: unknown; name: string; balance: number; pointsGiven: boolean;
      assignedPsId: unknown | null; assignmentType: string | null; liveUrl: string | null; repoUrl: string | null;
    }>();
    if (!team) return NextResponse.json({ team: null });
    const [members, holding, ps, settings, hasBid] = await Promise.all([
      TeamMember.find({ teamId: team._id }).select({ name: 1 }).sort({ createdAt: 1 }).lean<{ name: string }[]>(),
      Holding.findOne({ teamId: team._id }).select({ problemStatementId: 1, amount: 1 }).lean<{ problemStatementId: unknown; amount: number }>(),
      team.assignedPsId ? ProblemStatement.findById(team.assignedPsId).select({ title: 1, domain: 1, description: 1 }).lean<{ title: string; domain?: string; description: string }>() : null,
      getSettings(),
      Bid.exists({ teamId: team._id }),
    ]);
    return NextResponse.json({ team: {
      id: String(team._id), name: team.name, balance: team.balance, pointsGiven: team.pointsGiven,
      assignedPs: ps ? { title: ps.title, domain: ps.domain ?? "General", description: ps.description, assignmentType: team.assignmentType } : null,
      holding: holding ? { psId: String(holding.problemStatementId), amount: holding.amount } : null,
      members: members.map((member) => member.name),
      isLeader: role === "team_leader",
      canChangeMembership: settings.registrationOpen && !team.pointsGiven && !team.assignedPsId && !holding && !hasBid,
      submissionsOpen: settings.submissionsOpen,
      liveUrl: team.liveUrl,
      repoUrl: team.repoUrl,
    } });
  } catch (error) {
    console.error("Failed to fetch my team", error);
    return NextResponse.json({ error: "Unable to load your team." }, { status: 500 });
  }
}

const personName = z.string().trim().min(2).max(60).regex(/^[A-Za-z .'-]+$/);
const teamName = z.string().trim().min(3).max(40).refine((value) => !/[<>]/.test(value));
const year = z.enum(["UG1", "UG2", "UG3", "UG4"]);
const phone = z.string().trim().regex(/^\+?\d{10,15}$/);
const rollNumber = z.string().trim().transform(normalizeRollNumber).refine((value) => rollNumberPattern.test(value));
const branch = z.string().trim().min(1).max(100).regex(/^[A-Za-z .&()'-]+$/);
const httpsUrl = z.string().trim().url().max(300).refine((value) => new URL(value).protocol === "https:");
const memberSchema = z.object({ name: personName, email: z.string().trim().email().max(254), rollNumber, year, branch }).strict();
const registrationSchema = z
  .object({
    teamName,
    track: z.enum(["web_dev", "ai_ml"]),
    leader: z.object({ name: personName, phone, rollNumber, year, branch }).strict(),
    members: z.array(memberSchema).max(2),
    rulesAccepted: z.literal(true),
    previousHackathonExperience: z.enum(["none", "1-2", "3_or_more"]).optional(),
    githubUrl: httpsUrl.optional(),
    linkedinUrl: httpsUrl.optional(),
  })
  .strict();

function getClientIdentifier(request: Request, email: string) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const ip = forwardedFor?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  return `${email}:${ip}`;
}

function invalidMemberEmail(email: string) {
  const normalized = normalizeEmail(email);
  const atIndex = normalized.lastIndexOf("@");
  return !isAllowedDomain(normalized) || atIndex <= 0 || normalized.slice(0, atIndex).includes("+");
}

export async function POST(request: Request) {
  if (!checkOrigin(request)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  try {
    await connectToDatabase();
    const session = await auth();
    const rawLeaderEmail = session?.user?.email;
    if (!rawLeaderEmail) {
      return NextResponse.json({ error: "Please sign in to register a team." }, { status: 401 });
    }

    const leaderEmail = normalizeEmail(rawLeaderEmail);
    const role = await getRoleForEmail(leaderEmail);
    if (role !== "student") {
      return NextResponse.json({ error: "Only students who are not already on a team can register one." }, { status: 403 });
    }

    const rateLimit = await checkTeamRegistrationRateLimit(getClientIdentifier(request, leaderEmail));
    if (!rateLimit.allowed) {
      const error = rateLimit.reason === "limited" ? "Too many registration attempts. Please try again later." : "Registration is temporarily unavailable.";
      return NextResponse.json({ error }, { status: rateLimit.reason === "limited" ? 429 : 503 });
    }

    const parsed = registrationSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Enter a valid team name and member details." }, { status: 400 });
    }

    const settings = await getSettings();
    if (!settings.registrationOpen) {
      return NextResponse.json({ error: "Team registration is currently closed." }, { status: 403 });
    }

    const members = [
      { ...parsed.data.leader, email: leaderEmail, normalizedEmail: leaderEmail, normalizedRollNumber: normalizeRollNumber(parsed.data.leader.rollNumber) },
      ...parsed.data.members.map((member) => ({ ...member, email: normalizeEmail(member.email), normalizedEmail: normalizeEmail(member.email), normalizedRollNumber: normalizeRollNumber(member.rollNumber), phone: null })),
    ];
    const emails = members.map((member) => member.email);
    const rollNumbers = members.map((member) => member.normalizedRollNumber);
    if (new Set(emails).size !== emails.length) {
      return NextResponse.json({ error: "Each team member must have a different email address." }, { status: 400 });
    }
    if (members.some((member) => invalidMemberEmail(member.email))) {
      return NextResponse.json({ error: "Each member must use an eligible college email address without a plus alias." }, { status: 400 });
    }
    if (new Set(rollNumbers).size !== rollNumbers.length) {
      return NextResponse.json({ error: "Each team member must have a different roll number." }, { status: 400 });
    }
    if (members.length < settings.minTeamSize || members.length > settings.maxTeamSize) {
      return NextResponse.json(
        { error: `A team must have between ${settings.minTeamSize} and ${settings.maxTeamSize} members.` },
        { status: 400 },
      );
    }
    if (!isTrackYearCombinationValid(parsed.data.track, members.map((member) => member.year))) {
      return NextResponse.json({ error: "web_dev teams must contain only UG1 members; ai_ml teams must use one shared year from UG2 through UG4." }, { status: 400 });
    }
    if (members.some((member) => !isRollNumberValidForYear(member.rollNumber, member.year, settings.eventYear))) {
      return NextResponse.json({ error: "Each roll number must match the member's UG year." }, { status: 400 });
    }

    const normalizedName = parsed.data.teamName.trim().toLowerCase();
    const [adminEmails, judgeEmails, existingMembers, existingRollNumbers] = await Promise.all([
      AdminAllowlist.find({ email: { $in: emails } }).select({ email: 1 }).lean(),
      JudgeAllowlist.find({ email: { $in: emails } }).select({ email: 1 }).lean(),
      TeamMember.find({ email: { $in: emails } }).select({ email: 1 }).lean(),
      TeamMember.find({ normalizedRollNumber: { $in: rollNumbers } }).select({ normalizedRollNumber: 1 }).lean(),
    ]);
    const protectedEmails = new Set([
      ...getSuperAdminEmails(),
      ...adminEmails.map((entry) => entry.email),
      ...judgeEmails.map((entry) => entry.email),
    ]);
    if (emails.some((email) => protectedEmails.has(email))) {
      return NextResponse.json({ error: "A team member is not eligible to join a team." }, { status: 400 });
    }
    if (existingMembers.length > 0) {
      return NextResponse.json({ error: "A member is already in a team." }, { status: 409 });
    }
    if (existingRollNumbers.length > 0) {
      return NextResponse.json({ error: "A roll number is already in a team." }, { status: 409 });
    }

    const actor = await User.findOne({ email: leaderEmail }).select({ _id: 1 }).lean<{ _id: mongoose.Types.ObjectId }>();
    const dbSession = await mongoose.startSession();
    try {
      let createdTeamId: mongoose.Types.ObjectId | null = null;
      await dbSession.withTransaction(async () => {
        const latestSettings = await getSettings();
        if (!latestSettings.registrationOpen) throw new RegistrationClosedError();
        if (members.length < latestSettings.minTeamSize || members.length > latestSettings.maxTeamSize) throw new TeamSizeError();
        if (!isTrackYearCombinationValid(parsed.data.track, members.map((member) => member.year))) throw new TrackYearError();
        if (members.some((member) => !isRollNumberValidForYear(member.rollNumber, member.year, latestSettings.eventYear))) throw new RollNumberYearError();

        const [team, conflictingMember, conflictingRollNumber, conflictingRole] = await Promise.all([
          Team.create([{
            name: parsed.data.teamName.trim(), normalizedName, leaderEmail, track: parsed.data.track,
            previousHackathonExperience: parsed.data.previousHackathonExperience ?? null,
            githubUrl: parsed.data.githubUrl ?? null, linkedinUrl: parsed.data.linkedinUrl ?? null,
            rulesAcceptedAt: new Date(),
          }], { session: dbSession }),
          TeamMember.exists({ email: { $in: emails } }).session(dbSession),
          TeamMember.exists({ normalizedRollNumber: { $in: rollNumbers } }).session(dbSession),
          Promise.all([
            AdminAllowlist.exists({ email: { $in: emails } }).session(dbSession),
            JudgeAllowlist.exists({ email: { $in: emails } }).session(dbSession),
          ]),
        ]);
        if (conflictingMember || conflictingRollNumber) throw new MemberAlreadyInTeamError();
        if (conflictingRole.some(Boolean) || emails.some((email) => getSuperAdminEmails().includes(email))) {
          throw new IneligibleMemberError();
        }

        const created = team[0];
        createdTeamId = created._id;
        await TeamMember.insertMany(members.map((member) => ({ ...member, teamId: created._id })), { session: dbSession });
        await AuditLog.create(
          [{ action: "team.registered", actorUserId: actor?._id ?? null, targetType: "Team", targetId: created._id, newValue: { name: created.name, track: created.track } }],
          { session: dbSession },
        );
      });
      return NextResponse.json({ teamId: String(createdTeamId) }, { status: 201 });
    } finally {
      await dbSession.endSession();
    }
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Invalid registration data." }, { status: 400 });
    if (error instanceof RegistrationClosedError) return NextResponse.json({ error: "Team registration is currently closed." }, { status: 403 });
    if (error instanceof TeamSizeError) return NextResponse.json({ error: "The team size no longer meets the current limits." }, { status: 400 });
    if (error instanceof TrackYearError) return NextResponse.json({ error: "The team no longer meets the selected track's year rules." }, { status: 400 });
    if (error instanceof RollNumberYearError) return NextResponse.json({ error: "A roll number no longer matches its member's UG year." }, { status: 400 });
    if (error instanceof MemberAlreadyInTeamError) return NextResponse.json({ error: "A member is already in a team." }, { status: 409 });
    if (error instanceof IneligibleMemberError) return NextResponse.json({ error: "A team member is not eligible to join a team." }, { status: 400 });
    if (error instanceof mongoose.Error.ValidationError || (error as { code?: number }).code === 11000) {
      return NextResponse.json({ error: "That team name or a member is already in a team." }, { status: 409 });
    }
    console.error("Unable to register team", error);
    return NextResponse.json({ error: "Unable to register the team. Please try again." }, { status: 500 });
  }
}

class RegistrationClosedError extends Error {}
class TeamSizeError extends Error {}
class MemberAlreadyInTeamError extends Error {}
class IneligibleMemberError extends Error {}
class TrackYearError extends Error {}
class RollNumberYearError extends Error {}
