import { NextResponse } from "next/server";
import { z } from "zod";
import { reassignPs } from "@/lib/allocation";
import { allocationErrorResponse } from "@/lib/allocation-response";
import { AdminAuthError, checkOrigin, requireAdmin } from "@/lib/admin-auth";
import { connectToDatabase } from "@/lib/db";
import { checkAdminMutationRateLimit } from "@/lib/rate-limit";

const objectId = z.string().regex(/^[0-9a-f]{24}$/i);
const schema = z.object({
  teamId: objectId,
  problemStatementId: objectId,
  exceedCapacityConfirmed: z.boolean().optional(),
  superAdminConfirmed: z.boolean().optional(),
}).strict();

function identifier(request: Request, email: string) {
  return `${email}:${request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"}`;
}

export async function POST(request: Request) {
  if (!checkOrigin(request)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  try {
    await connectToDatabase();
    const actor = await requireAdmin("admin");
    const limit = await checkAdminMutationRateLimit(identifier(request, actor.email));
    if (!limit.allowed) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Invalid reassignment request." }, { status: 400 });

    const result = await reassignPs({
      teamId: parsed.data.teamId,
      newPsId: parsed.data.problemStatementId,
      actorEmail: actor.email,
      exceedCapacityConfirmed: parsed.data.exceedCapacityConfirmed,
      superAdminConfirmed: parsed.data.superAdminConfirmed,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AdminAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    const allocationError = allocationErrorResponse(error);
    if (allocationError) return allocationError;
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Invalid reassignment request." }, { status: 400 });
    console.error("Failed to reassign problem statement", error);
    return NextResponse.json({ error: "Unable to reassign the problem statement." }, { status: 500 });
  }
}
