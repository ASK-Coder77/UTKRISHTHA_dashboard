import { NextResponse } from "next/server";
import { randomlyAllocate } from "@/lib/allocation";
import { allocationErrorResponse } from "@/lib/allocation-response";
import { AdminAuthError, checkOrigin, requireAdmin } from "@/lib/admin-auth";
import { connectToDatabase } from "@/lib/db";
import { checkAdminMutationRateLimit } from "@/lib/rate-limit";

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

    const result = await randomlyAllocate({ actorEmail: actor.email });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AdminAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    const allocationError = allocationErrorResponse(error);
    if (allocationError) return allocationError;
    console.error("Failed to randomly allocate teams", error);
    return NextResponse.json({ error: "Unable to allocate teams." }, { status: 500 });
  }
}
