import { NextResponse } from "next/server";
import { z } from "zod";
import { connectToDatabase } from "@/lib/db";
import { AdminAuthError, checkOrigin, requireAdmin } from "@/lib/admin-auth";
import { checkAdminMutationRateLimit } from "@/lib/rate-limit";
import { AuditLog } from "@/models/AuditLog";
import { Setting } from "@/models/Setting";

const schema = z.object({ registrationOpen: z.boolean() }).strict();

function getIdentifier(request: Request, email: string) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  return `${email}:${ip}`;
}

export async function PATCH(request: Request) {
  if (!checkOrigin(request)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  try {
    await connectToDatabase();
    const actor = await requireAdmin("admin");

    const rl = await checkAdminMutationRateLimit(getIdentifier(request, actor.email));
    if (!rl.allowed) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Invalid value for registrationOpen." }, { status: 400 });

    const current = await Setting.findOne({ singletonKey: "global" })
      .lean<{ _id: unknown; registrationOpen: boolean }>();
    if (!current) return NextResponse.json({ error: "Settings not found." }, { status: 500 });

    if (current.registrationOpen === parsed.data.registrationOpen) {
      return NextResponse.json({ registrationOpen: current.registrationOpen });
    }

    await Setting.updateOne(
      { singletonKey: "global" },
      { $set: { registrationOpen: parsed.data.registrationOpen } },
    );

    await AuditLog.create([{
      action: "setting.changed",
      actorUserId: actor.userId,
      targetType: "Setting",
      targetId: current._id,
      previousValue: { registrationOpen: current.registrationOpen },
      newValue: { registrationOpen: parsed.data.registrationOpen },
    }]);

    return NextResponse.json({ registrationOpen: parsed.data.registrationOpen });
  } catch (error) {
    if (error instanceof AdminAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    console.error("Failed to toggle registration", error);
    return NextResponse.json({ error: "Unable to update registration status." }, { status: 500 });
  }
}
