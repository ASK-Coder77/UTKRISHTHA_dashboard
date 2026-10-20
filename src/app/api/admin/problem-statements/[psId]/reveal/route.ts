import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import { AdminAuthError, checkOrigin, isValidObjectId, requireAdmin } from "@/lib/admin-auth";
import { checkAdminMutationRateLimit } from "@/lib/rate-limit";
import { AuditLog } from "@/models/AuditLog";
import { ProblemStatement } from "@/models/ProblemStatement";

type Params = { params: Promise<{ psId: string }> };
const identifier = (request: Request, email: string) => `${email}:${request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"}`;

export async function POST(request: Request, { params }: Params) {
  if (!checkOrigin(request)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  const { psId } = await params;
  if (!isValidObjectId(psId)) return NextResponse.json({ error: "Invalid problem statement ID." }, { status: 400 });
  try {
    await connectToDatabase();
    const actor = await requireAdmin("admin");
    if (!(await checkAdminMutationRateLimit(identifier(request, actor.email))).allowed) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    const updated = await ProblemStatement.findOneAndUpdate({ _id: psId, revealed: false }, { $set: { revealed: true } }, { new: true }).lean<{ _id: unknown }>();
    if (!updated) return NextResponse.json({ error: "Problem statement was not found or has already been revealed." }, { status: 409 });
    await AuditLog.create([{ action: "ps.revealed", actorUserId: actor.userId, targetType: "ProblemStatement", targetId: updated._id, previousValue: { revealed: false }, newValue: { revealed: true } }]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AdminAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Failed to reveal problem statement", error);
    return NextResponse.json({ error: "Unable to reveal problem statement." }, { status: 500 });
  }
}
